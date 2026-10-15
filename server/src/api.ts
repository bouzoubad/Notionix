import type { IncomingMessage, ServerResponse } from 'http'
import { createWriteStream } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import { Accounts, AuthError, LoginThrottle, ROLES, type Role, type User } from './auth'
import { MAX_ASSET_BYTES, MAX_FILE_BYTES } from '../../src/core/assets'
import { ASSET_TYPES } from '../../src/shared/assets'
import { importNotionExport } from '../../src/core/transfer/notionImport'
import { buildMarkdownArchive } from '../../src/core/transfer/markdownExport'
import { buildHtmlArchive } from '../../src/core/transfer/htmlExport'
import { CallContext, ForbiddenError, resolveCall, RpcError, runCall } from './rpc'
import type { Workspace } from './workspace'
import { PublicPages } from './publicPages'
import { FeedbackError, FeedbackRepository } from './feedback'
import { FEEDBACK_STATUS_LABELS } from '../../src/shared/collab'

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
  /** Replaces the content of a page's shared document (restoring a saved state) */
  replaceContent: (pageId: string, content: string, user: User) => Promise<void>
  /** Tells these people their inbox changed */
  notifyUsers: (userIds: string[]) => void
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
  const members = (): User[] => accounts.list()
  const publicPages = new PublicPages(workspace)
  const feedback = new FeedbackRepository(accounts.db)

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    if (!path.startsWith('/api/')) return false
    try {
      const method = req.method ?? 'GET'
      if (path === '/api/health' && method === 'GET') {
        send(res, 200, { ok: true, version: SERVER_VERSION })
      } else if (path.startsWith('/api/public/') && (method === 'GET' || method === 'HEAD')) {
        // Published pages: no session, the link is the key.
        const [token, kind, rest] = path.slice('/api/public/'.length).split('/')
        collab.flush()
        if (kind === 'assets' && rest) {
          const name = decodeURIComponent(rest)
          if (!publicPages.servesAsset(token, name)) throw new HttpError(404, 'Introuvable.')
          const asset = await workspace.assets.load(name)
          if (!asset) throw new HttpError(404, 'Introuvable.')
          res.writeHead(200, {
            'Content-Type': asset.type,
            'Content-Length': asset.bytes.length,
            'Cache-Control': 'public, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
          })
          res.end(method === 'HEAD' ? undefined : asset.bytes)
        } else {
          const page = publicPages.page(
            token,
            kind === 'pages' ? decodeURIComponent(rest ?? '') : undefined
          )
          if (!page) throw new HttpError(404, 'Page introuvable ou plus publiée.')
          send(res, 200, { page })
        }
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
      } else if (path === '/api/feedback' && method === 'GET') {
        // Administrators see every report; everyone else their own.
        const user = requireUser(req)
        send(res, 200, { feedback: feedback.list(user.role === 'admin' ? null : user.id) })
      } else if (path === '/api/feedback' && method === 'POST') {
        const user = requireUser(req)
        const item = feedback.create(user.id, await readJson(req))
        const admins = accounts
          .list()
          .filter((u) => u.role === 'admin' && !u.disabled && u.id !== user.id)
        const sent = workspace.team.notify(
          admins.map((a) => a.id),
          {
            kind: 'feedback',
            pageId: null,
            actorId: user.id,
            ref: item.id,
            text: `${item.kind === 'bug' ? 'Bug signalé' : 'Idée proposée'} par ${user.name} : ${item.title}`
          }
        )
        collab.notifyUsers(sent)
        send(res, 201, { feedback: item })
      } else if (path.startsWith('/api/feedback/') && (method === 'PATCH' || method === 'DELETE')) {
        const admin = requireUser(req, ['admin'])
        const id = decodeURIComponent(path.slice('/api/feedback/'.length))
        if (method === 'DELETE') {
          feedback.remove(id)
          send(res, 200, { ok: true })
        } else {
          const before = feedback.get(id)
          const item = feedback.update(id, await readJson(req))
          // The sender hears about the answer or the new status.
          if (
            before &&
            item.userId &&
            (before.status !== item.status || before.reply !== item.reply)
          ) {
            const sent = workspace.team.notify([item.userId], {
              kind: 'feedback',
              pageId: null,
              actorId: admin.id,
              ref: item.id,
              text: `Votre retour « ${item.title} » : ${FEEDBACK_STATUS_LABELS[item.status]}${item.reply ? ` — ${item.reply.slice(0, 140)}` : ''}`
            })
            collab.notifyUsers(sent)
          }
          send(res, 200, { feedback: item })
        }
      } else if (path === '/api/tokens' && method === 'GET') {
        const user = requireUser(req)
        send(res, 200, { tokens: accounts.tokens(user.id) })
      } else if (path === '/api/tokens' && method === 'POST') {
        const user = requireUser(req)
        const body = await readJson(req)
        send(res, 201, accounts.createToken(user.id, str(body.name) ?? ''))
      } else if (path.startsWith('/api/tokens/') && method === 'DELETE') {
        const user = requireUser(req)
        accounts.revokeToken(user.id, decodeURIComponent(path.slice('/api/tokens/'.length)))
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
        const call = resolveCall(str(body.method) ?? '', body.args ?? [])
        if (call === null) throw new HttpError(404, 'Opération inconnue.')
        if (call.readsContent) collab.flush()
        let result: unknown
        try {
          result = await runCall(call, new CallContext(workspace, user, members, collab))
        } catch (e) {
          if (e instanceof RpcError) throw e
          if (e instanceof ForbiddenError) throw new HttpError(403, e.message)
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
          // The import awaits between steps: its pages are written as the importer.
          workspace.pages.actor = user.id
          const summary = await importNotionExport(workspace.pages, file, workspace.assets).finally(
            () => (workspace.pages.actor = null)
          )
          collab.changed(user)
          send(res, 200, { result: summary })
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      } else if (path === '/api/transfer/export' && method === 'GET') {
        const user = requireUser(req)
        collab.flush()
        const page = url.searchParams.get('page')
        // Only the pages the person can read are exported.
        const ctx = new CallContext(workspace, user, members)
        if (page) ctx.need(page, 'read')
        const build =
          url.searchParams.get('format') === 'html' ? buildHtmlArchive : buildMarkdownArchive
        const archive = await build(
          {
            list: () => ctx.filter(workspace.pages.list()),
            get: (id) => (ctx.level(id) === 'none' ? null : workspace.pages.get(id))
          },
          workspace.databases,
          workspace.assets,
          page || null,
          ctx.people()
        )
        res.writeHead(200, {
          'Content-Type': archive.fileName.endsWith('.md')
            ? 'text/markdown; charset=utf-8'
            : archive.fileName.endsWith('.html')
              ? 'text/html; charset=utf-8'
              : 'application/zip',
          // Downloaded, never shown: the content is the workspace's own HTML.
          'Content-Security-Policy': "default-src 'none'; sandbox",
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
        const file = url.searchParams.get('file') === '1'
        let src: string
        try {
          src = file
            ? await workspace.assets.saveFile(await readBody(req, MAX_FILE_BYTES), hint)
            : await workspace.assets.save(await readBody(req, MAX_ASSET_BYTES), hint)
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
            await workspace.assets.put(name, await readBody(req, MAX_FILE_BYTES))
          } catch (e) {
            if (e instanceof HttpError) throw e
            throw new HttpError(400, e instanceof Error ? e.message : 'Image refusée.')
          }
          send(res, 200, { ok: true })
        } else if (method === 'GET' || method === 'HEAD') {
          requireUser(req)
          const asset = await workspace.assets.load(name)
          if (!asset) throw new HttpError(404, 'Image introuvable.')
          // Shown in the page (images, media, PDF) unless asked as a download.
          const download = url.searchParams.get('download')
          const inline = !download && ASSET_TYPES[name.split('.')[1]]?.inline
          const fileName = (download ?? name).replace(/[\r\n"]/g, '').slice(0, 200) || name
          res.writeHead(200, {
            'Content-Type': asset.type,
            'Content-Length': asset.bytes.length,
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            // Content-addressed: the bytes behind a name never change.
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
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
      } else if (e instanceof FeedbackError) {
        send(res, 400, { error: e.message })
      } else if (e instanceof ForbiddenError) {
        send(res, 403, { error: e.message })
      } else {
        console.error(e)
        send(res, 500, { error: 'Erreur interne du serveur.' })
      }
    }
    return true
  }
}
