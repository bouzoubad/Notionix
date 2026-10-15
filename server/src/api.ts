import type { IncomingMessage, ServerResponse } from 'http'
import { createWriteStream } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { Accounts, AuthError, LoginThrottle, ROLES, type Role, type User } from './auth'
import { MAX_ASSET_BYTES } from '../../src/core/assets'
import { importNotionExport } from '../../src/core/transfer/notionImport'
import { buildMarkdownArchive } from '../../src/core/transfer/markdownExport'
import { resolveCall, RpcError } from './rpc'
import type { Workspace } from './workspace'

export const SERVER_VERSION = '0.2.0'
const MAX_JSON_BYTES = 4 * 1024 * 1024
/** A Notion export with its images can be large; it is written to a temporary file. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024
export const SESSION_COOKIE = 'notionix_session'
/**
 * Header the web client sends with every change. A page on another site cannot
 * add it without the server's consent, so the session cookie alone never
 * authorises a change (cross-site request forgery).
 */
export const CLIENT_HEADER = 'x-notionix-client'

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'Contenu trop volumineux.')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req, MAX_JSON_BYTES)
  try {
    const value = JSON.parse(body.toString('utf8') || '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'JSON invalide.')
  }
}

/** Streams the request body to a file, refusing more than `limit` bytes. */
async function saveBody(req: IncomingMessage, path: string, limit: number): Promise<void> {
  let size = 0
  const guard = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      done(size > limit ? new HttpError(413, 'Fichier trop volumineux.') : null, chunk)
    }
  })
  await pipeline(req, guard, createWriteStream(path))
}

const send = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  })
  res.end(JSON.stringify(body))
}

export const bearer = (header: string | undefined | null): string | null =>
  header?.startsWith('Bearer ') ? header.slice(7).trim() || null : null

/** Session token carried by the web client's cookie. */
export function cookieToken(header: string | undefined | null): string | null {
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('=')) || null
  }
  return null
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** HTTPS directly, or behind a reverse proxy (IIS) that says so. */
const isHttps = (req: IncomingMessage): boolean =>
  (req.socket as { encrypted?: boolean }).encrypted === true ||
  String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim() === 'https'

const sessionCookie = (req: IncomingMessage, token: string, maxAge: number): string =>
  [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    ...(isHttps(req) ? ['Secure'] : [])
  ].join('; ')

/** What the API needs from the real-time side. */
export interface CollabHooks {
  /** Writes the content of pages being edited to the workspace before it is read */
  flush: () => void
  /** Announces a change of pages or databases to every client */
  changed: (by: User) => void
}

export interface ApiOptions {
  accounts: Accounts
  workspace: Workspace
  collab: CollabHooks
  sessionDays: number
  throttle?: LoginThrottle
}

/**
 * HTTP API: login and sessions, account administration, the workspace
 * operations, images, Notion import and Markdown export. Returns false for
 * requests it does not handle (WebSocket upgrades, paths outside /api).
 */
export function createApi({
  accounts,
  workspace,
  collab,
  sessionDays,
  throttle = new LoginThrottle()
}: ApiOptions) {
  const requireUser = (req: IncomingMessage, roles: Role[] = ROLES): User => {
    const header = bearer(req.headers.authorization)
    const cookie = header ? null : cookieToken(req.headers.cookie)
    const user = accounts.authenticate(header ?? cookie)
    if (!user) throw new HttpError(401, 'Connexion requise.')
    const safe = req.method === 'GET' || req.method === 'HEAD'
    if (cookie && !safe && req.headers[CLIENT_HEADER] !== 'web')
      throw new HttpError(403, 'Requête refusée.')
    if (!roles.includes(user.role)) throw new HttpError(403, 'Droits insuffisants.')
    return user
  }
  const editors: Role[] = ['admin', 'editor']

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    if (!path.startsWith('/api/')) return false
    try {
      const method = req.method ?? 'GET'
      if (path === '/api/health' && method === 'GET') {
        send(res, 200, { ok: true, version: SERVER_VERSION })
      } else if (path === '/api/login' && method === 'POST') {
        const body = await readJson(req)
        const email = str(body.email) ?? ''
        const key = `${email.toLowerCase()}|${req.socket.remoteAddress ?? ''}`
        throttle.check(key)
        try {
          const session = await accounts.login(email, str(body.password) ?? '')
          throttle.succeed(key)
          send(res, 200, session, {
            'Set-Cookie': sessionCookie(req, session.token, sessionDays * 86400)
          })
        } catch (e) {
          if (e instanceof AuthError && e.status === 401) throttle.fail(key)
          throw e
        }
      } else if (path === '/api/logout' && method === 'POST') {
        const token = bearer(req.headers.authorization) ?? cookieToken(req.headers.cookie)
        if (token) accounts.logout(token)
        send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) })
      } else if (path === '/api/me' && method === 'GET') {
        send(res, 200, { user: requireUser(req) })
      } else if (path === '/api/me/password' && method === 'POST') {
        const user = requireUser(req)
        const body = await readJson(req)
        await accounts
          .login(user.email, str(body.current) ?? '')
          .then(({ token }) => accounts.logout(token))
        await accounts.update(user.id, { password: str(body.next) ?? '' })
        send(res, 200, { ok: true })
      } else if (path === '/api/users' && method === 'GET') {
        requireUser(req, ['admin'])
        send(res, 200, { users: accounts.list() })
      } else if (path === '/api/users' && method === 'POST') {
        requireUser(req, ['admin'])
        const body = await readJson(req)
        const user = await accounts.create({
          email: str(body.email) ?? '',
          name: str(body.name) ?? '',
          role: (str(body.role) ?? 'editor') as Role,
          password: str(body.password) ?? ''
        })
        send(res, 201, { user })
      } else if (path.startsWith('/api/users/') && method === 'PATCH') {
        requireUser(req, ['admin'])
        const body = await readJson(req)
        const user = await accounts.update(decodeURIComponent(path.slice('/api/users/'.length)), {
          name: str(body.name),
          role: str(body.role) as Role | undefined,
          password: str(body.password),
          disabled: typeof body.disabled === 'boolean' ? body.disabled : undefined
        })
        send(res, 200, { user })
      } else if (path === '/api/rpc' && method === 'POST') {
        const user = requireUser(req)
        const body = await readJson(req)
        const call = resolveCall(str(body.method) ?? '', body.args ?? [], user.role)
        if (call === null) throw new HttpError(404, 'Opération inconnue.')
        if (call === 'forbidden') throw new HttpError(403, 'Droits insuffisants.')
        if (call.readsContent) collab.flush()
        let result: unknown
        try {
          result = call.method.run(workspace, call.args)
        } catch (e) {
          if (e instanceof RpcError) throw e
          throw new HttpError(400, e instanceof Error ? e.message : String(e))
        }
        if (call.method.write) collab.changed(user)
        send(res, 200, { result: result ?? null })
      } else if (path === '/api/transfer/import' && method === 'POST') {
        const user = requireUser(req, editors)
        const dir = await mkdtemp(join(tmpdir(), 'notionix-upload-'))
        try {
          const file = join(dir, 'export.zip')
          await saveBody(req, file, MAX_IMPORT_BYTES)
          const summary = await importNotionExport(workspace.pages, file, workspace.assets)
          collab.changed(user)
          send(res, 200, { result: summary })
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      } else if (path === '/api/transfer/export' && method === 'GET') {
        requireUser(req)
        collab.flush()
        const page = url.searchParams.get('page')
        const archive = await buildMarkdownArchive(
          workspace.pages,
          workspace.databases,
          workspace.assets,
          page || null
        )
        res.writeHead(200, {
          'Content-Type': archive.fileName.endsWith('.md')
            ? 'text/markdown; charset=utf-8'
            : 'application/zip',
          'Content-Length': archive.bytes.length,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(archive.fileName)}`,
          'X-Notionix-Pages': String(archive.pages),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        })
        res.end(archive.bytes)
      } else if (path === '/api/assets' && method === 'POST') {
        // The server names the image: the client needs no hashing (unavailable over plain HTTP).
        requireUser(req, editors)
        const hint = url.searchParams.get('name') ?? 'image'
        let src: string
        try {
          src = await workspace.assets.save(await readBody(req, MAX_ASSET_BYTES), hint)
        } catch (e) {
          if (e instanceof HttpError) throw e
          throw new HttpError(400, e instanceof Error ? e.message : 'Image refusée.')
        }
        send(res, 200, { src })
      } else if (path.startsWith('/api/assets/')) {
        const name = decodeURIComponent(path.slice('/api/assets/'.length))
        if (method === 'PUT') {
          requireUser(req, editors)
          try {
            await workspace.assets.put(name, await readBody(req, MAX_ASSET_BYTES))
          } catch (e) {
            if (e instanceof HttpError) throw e
            throw new HttpError(400, e instanceof Error ? e.message : 'Image refusée.')
          }
          send(res, 200, { ok: true })
        } else if (method === 'GET' || method === 'HEAD') {
          requireUser(req)
          const asset = await workspace.assets.load(name)
          if (!asset) throw new HttpError(404, 'Image introuvable.')
          res.writeHead(200, {
            'Content-Type': asset.type,
            'Content-Length': asset.bytes.length,
            // Content-addressed: the bytes behind a name never change.
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
          })
          res.end(method === 'HEAD' ? undefined : asset.bytes)
        } else {
          throw new HttpError(405, 'Méthode non autorisée.')
        }
      } else {
        throw new HttpError(404, 'Introuvable.')
      }
    } catch (e) {
      if (res.headersSent) {
        res.destroy()
      } else if (e instanceof HttpError || e instanceof AuthError) {
        send(res, e.status, { error: e.message })
      } else if (e instanceof RpcError) {
        send(res, 400, { error: e.message })
      } else {
        console.error(e)
        send(res, 500, { error: 'Erreur interne du serveur.' })
      }
    }
    return true
  }
}
