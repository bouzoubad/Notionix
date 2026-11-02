import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import type { IpcMain } from 'electron'
import {
  LANGUAGE_HEADER,
  MAIN_WORKSPACE,
  WORKSPACE_HEADER,
  type SessionUser
} from '../shared/collab'
import {
  normalizeServerUrl,
  OFFLINE_HEADER,
  type ProxyRequest,
  type ProxyResponse,
  type ServerLinkStatus,
  type ServerLoginError
} from '../shared/desktop'
import { ASSET_NAME } from '../shared/assets'
import { cacheKeyOf, ServerCache } from '../core/serverCache'

/** Keeps the session token unreadable on disk (the system keychain on macOS). */
export interface SecretBox {
  seal(text: string): string
  open(sealed: string): string
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

interface Saved {
  url: string
  email: string
  user: SessionUser
  /** Sealed session token; null once the session has ended */
  token: string | null
}

/** Headers of the page's requests passed on to the server. */
const REQUEST_HEADERS = [
  'content-type',
  WORKSPACE_HEADER.toLowerCase(),
  LANGUAGE_HEADER.toLowerCase()
]
/** Headers of the server's answers the page reads. */
const RESPONSE_HEADERS = ['content-type', 'content-disposition', 'x-notionix-pages']
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
/** Statuses whose answer has no body (a Response refuses one). */
const NO_BODY = new Set([101, 204, 205, 304])

const jsonAnswer = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): ProxyResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  body: new TextEncoder().encode(JSON.stringify(body))
})

/** Chromium's network errors that mean the server's certificate is not trusted. */
const isCertificateError = (e: unknown): boolean =>
  /CERT|SSL|certificate/i.test(e instanceof Error ? `${e.message} ${String(e.cause ?? '')}` : '')

/**
 * The desktop app's link to a Notionix server: signs in, keeps the session
 * (sealed), and sends the page's requests with it. The page never talks to
 * the server's API itself; the answers of operations that only read are kept,
 * so the team's pages stay readable without network.
 */
export class ServerLink {
  private saved: Saved | null = null

  constructor(
    private readonly file: string,
    private readonly cache: ServerCache,
    private readonly secrets: SecretBox,
    private readonly fetch: Fetch
  ) {
    try {
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>
        const url = typeof data.url === 'string' ? normalizeServerUrl(data.url) : null
        if (url && data.user && typeof data.user.id === 'string')
          this.saved = {
            url,
            email: typeof data.email === 'string' ? data.email : data.user.email,
            user: data.user,
            token: typeof data.token === 'string' ? data.token : null
          }
      }
    } catch {
      this.saved = null
    }
  }

  status(): ServerLinkStatus | null {
    const s = this.saved
    return s ? { url: s.url, email: s.email, user: s.user, signedIn: s.token !== null } : null
  }

  /** The session token, or null when signed out. */
  token(): string | null {
    if (!this.saved?.token) return null
    try {
      return this.secrets.open(this.saved.token)
    } catch {
      return null
    }
  }

  async login(
    address: string,
    email: string,
    password: string
  ): Promise<{ ok: true; status: ServerLinkStatus } | { ok: false; error: ServerLoginError }> {
    const url = normalizeServerUrl(address)
    if (!url) return { ok: false, error: { kind: 'refused', message: 'Adresse invalide.' } }
    let res: Response
    try {
      res = await this.fetch(`${url}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
    } catch (e) {
      return { ok: false, error: { kind: isCertificateError(e) ? 'certificate' : 'unreachable' } }
    }
    const body = (await res.json().catch(() => ({}))) as {
      token?: unknown
      user?: SessionUser
      error?: unknown
    }
    if (!res.ok || typeof body.token !== 'string' || !body.user) {
      const message = typeof body.error === 'string' ? body.error : `Erreur ${res.status}`
      return { ok: false, error: { kind: 'refused', message } }
    }
    // Another server (or another person): what was kept belongs to the previous one.
    if (this.saved?.url !== url || this.saved.user.id !== body.user.id) this.cache.clear()
    this.saved = { url, email, user: body.user, token: this.secrets.seal(body.token) }
    this.write()
    return { ok: true, status: this.status()! }
  }

  async logout(): Promise<void> {
    const token = this.token()
    if (this.saved && token) {
      await this.fetch(`${this.saved.url}/api/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => undefined)
    }
    this.saved = null
    this.cache.clear()
    rmSync(this.file, { force: true })
  }

  /** Sends one request of the page to the server; answers from the cache when it is out of reach. */
  async request(path: string, init: ProxyRequest): Promise<ProxyResponse> {
    const s = this.saved
    const token = this.token()
    if (!s || !token) return jsonAnswer(401, { error: 'Connexion requise.' })
    if (!/^\/api\/[^\s#\\]*$/.test(path) || path.includes('..') || !METHODS.has(init.method))
      return jsonAnswer(400, { error: 'Requête refusée.' })
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    for (const [name, value] of Object.entries(init.headers ?? {}))
      if (REQUEST_HEADERS.includes(name.toLowerCase()) && typeof value === 'string')
        headers[name] = value
    const workspace =
      Object.entries(headers).find(
        ([n]) => n.toLowerCase() === WORKSPACE_HEADER.toLowerCase()
      )?.[1] ?? MAIN_WORKSPACE
    const key = cacheKeyOf(
      s.url,
      workspace,
      init.method,
      path.split('?')[0],
      typeof init.body === 'string' ? init.body : null
    )
    let res: Response
    try {
      res = await this.fetch(`${s.url}${path}`, {
        method: init.method,
        headers,
        body: init.body as BodyInit | undefined
      })
    } catch {
      const kept = key ? this.cache.get(key) : null
      if (kept)
        return {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            [OFFLINE_HEADER]: String(kept.at)
          },
          body: kept.body
        }
      return jsonAnswer(
        503,
        { error: 'Serveur injoignable : vous êtes hors ligne.' },
        { [OFFLINE_HEADER]: '0' }
      )
    }
    const body = NO_BODY.has(res.status) ? null : new Uint8Array(await res.arrayBuffer())
    // The session has ended: the person signs in again.
    if (res.status === 401) this.expire()
    else if (res.ok && key && body) this.cache.put(key, body)
    const out: Record<string, string> = {}
    for (const name of RESPONSE_HEADERS) {
      const value = res.headers.get(name)
      if (value !== null) out[name] = value
    }
    return { status: res.status, headers: out, body }
  }

  /** A file of the server (image, attachment) by its name; null when unavailable. */
  async asset(name: string): Promise<Uint8Array | null> {
    const s = this.saved
    const token = this.token()
    if (!s || !token || !ASSET_NAME.test(name)) return null
    try {
      const res = await this.fetch(`${s.url}/api/assets/${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    } catch {
      return null
    }
  }

  private expire(): void {
    if (!this.saved) return
    this.saved = { ...this.saved, token: null }
    this.write()
  }

  private write(): void {
    writeFileSync(this.file, JSON.stringify(this.saved), { mode: 0o600 })
  }
}

/** The page's calls to the server link. */
export function registerServerHandlers(ipc: IpcMain, link: ServerLink): void {
  ipc.handle('server:status', () => link.status())
  ipc.handle('server:login', (_e, url: unknown, email: unknown, password: unknown) => {
    if (typeof url !== 'string' || typeof email !== 'string' || typeof password !== 'string')
      throw new Error('Arguments invalides.')
    return link.login(url, email, password)
  })
  ipc.handle('server:logout', () => link.logout())
  ipc.handle('server:request', (_e, path: unknown, init: unknown) => {
    if (typeof path !== 'string' || !init || typeof init !== 'object')
      throw new Error('Arguments invalides.')
    return link.request(path, init as ProxyRequest)
  })
  ipc.handle('server:token', () => link.token())
}
