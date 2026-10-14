import type { IncomingMessage, ServerResponse } from 'http'
import { Accounts, AuthError, LoginThrottle, ROLES, type Role, type User } from './auth'
import { MAX_ASSET_BYTES, type ServerAssets } from './assets'

export const SERVER_VERSION = '0.1.0'
const MAX_JSON_BYTES = 64 * 1024

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

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(JSON.stringify(body))
}

export const bearer = (header: string | undefined): string | null =>
  header?.startsWith('Bearer ') ? header.slice(7).trim() || null : null

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * HTTP API: login and sessions, account administration, images. Returns
 * false for requests it does not handle (WebSocket upgrades, unknown paths).
 */
export function createApi(accounts: Accounts, assets: ServerAssets, throttle = new LoginThrottle()) {
  const requireUser = (req: IncomingMessage, roles: Role[] = ROLES): User => {
    const user = accounts.authenticate(bearer(req.headers.authorization))
    if (!user) throw new HttpError(401, 'Connexion requise.')
    if (!roles.includes(user.role)) throw new HttpError(403, 'Droits insuffisants.')
    return user
  }

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
          send(res, 200, session)
        } catch (e) {
          if (e instanceof AuthError && e.status === 401) throttle.fail(key)
          throw e
        }
      } else if (path === '/api/logout' && method === 'POST') {
        const token = bearer(req.headers.authorization)
        if (token) accounts.logout(token)
        send(res, 200, { ok: true })
      } else if (path === '/api/me' && method === 'GET') {
        send(res, 200, { user: requireUser(req) })
      } else if (path === '/api/me/password' && method === 'POST') {
        const user = requireUser(req)
        const body = await readJson(req)
        await accounts.login(user.email, str(body.current) ?? '').then(({ token }) => accounts.logout(token))
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
      } else if (path.startsWith('/api/assets/')) {
        const name = decodeURIComponent(path.slice('/api/assets/'.length))
        if (method === 'PUT') {
          requireUser(req, ['admin', 'editor'])
          try {
            await assets.put(name, await readBody(req, MAX_ASSET_BYTES))
          } catch (e) {
            if (e instanceof HttpError) throw e
            throw new HttpError(400, e instanceof Error ? e.message : 'Image refusée.')
          }
          send(res, 200, { ok: true })
        } else if (method === 'GET' || method === 'HEAD') {
          requireUser(req)
          const asset = await assets.get(name)
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
      if (e instanceof HttpError || e instanceof AuthError) send(res, e.status, { error: e.message })
      else {
        console.error(e)
        send(res, 500, { error: 'Erreur interne du serveur.' })
      }
    }
    return true
  }
}
