import type { SessionUser } from './collab'
import type { NotionixApi, PageId, PageTreeNode } from './types'

/**
 * The Notionix server the desktop app is linked to. `signedIn` is false once
 * the session has ended (expired, signed out elsewhere): the app then asks
 * for the password again.
 */
export interface ServerLinkStatus {
  url: string
  email: string
  user: SessionUser
  signedIn: boolean
}

/** Why signing in to a server failed; `message` is the server's own text (French). */
export type ServerLoginError =
  { kind: 'certificate' } | { kind: 'unreachable' } | { kind: 'refused'; message: string }

/** Who an activation link is for (shared through Keeper). */
export interface ActivationInfo {
  url: string
  email: string
  name: string
}

/** A request to the server, sent by the desktop app's main process with the session. */
export interface ProxyRequest {
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers: Record<string, string>
  body?: string | Uint8Array
}

export interface ProxyResponse {
  status: number
  headers: Record<string, string>
  body: Uint8Array | null
}

/** Answer kept from an earlier connection: the server was out of reach (value: when kept, ms). */
export const OFFLINE_HEADER = 'x-notionix-offline'

/** The link between the desktop app and a Notionix server. */
export interface DesktopServer {
  /** The linked server, or null when the app only works on this computer */
  status(): Promise<ServerLinkStatus | null>
  login(
    url: string,
    email: string,
    password: string
  ): Promise<{ ok: true; status: ServerLinkStatus } | { ok: false; error: ServerLoginError }>
  /** Who an activation link is for; the link is checked by its server */
  activation(
    link: string
  ): Promise<{ ok: true; info: ActivationInfo } | { ok: false; error: ServerLoginError }>
  /** Activates the account of the link with the chosen password, and links the app */
  activate(
    link: string,
    password: string
  ): Promise<{ ok: true; status: ServerLinkStatus } | { ok: false; error: ServerLoginError }>
  /** Signs out and unlinks the server; the pages on this computer stay */
  logout(): Promise<void>
  /** Sends a request of the web client's API (`/api/…`) to the server */
  request(path: string, init: ProxyRequest): Promise<ProxyResponse>
  /** The session token, for the real-time connection */
  token(): Promise<string | null>
  /** Checks now whether the server can be reached (requests then go to it again) */
  probe(): Promise<boolean>
}

/**
 * This computer's pages as stored, to send them to the linked server: pages
 * written without network wait here, then move there with the same ids.
 */
export interface DesktopLocalStore {
  /** A page and its sub-pages, parents first */
  tree(rootId: PageId): Promise<PageTreeNode[]>
  /** The bytes of a file of these pages, by its name (<sha256>.<ext>); null when missing */
  asset(name: string): Promise<Uint8Array | null>
  /** Once on the server: a copy kept in a file, then the pages deleted here */
  forget(rootId: PageId): Promise<void>
}

/** Where the update of the desktop app is (from the linked server). */
export type UpdateState =
  | { status: 'unsupported' }
  | { status: 'idle' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

/** The desktop app's own updates, downloaded from the linked server. */
export interface DesktopUpdates {
  state(): Promise<UpdateState>
  /** Asks the server for a newer version (downloaded at once when there is one) */
  check(): Promise<UpdateState>
  /** Restarts the app on the version downloaded */
  install(): Promise<void>
  onChange(listener: (state: UpdateState) => void): () => void
}

/** What the desktop app's preload gives the page. */
export interface DesktopBridge {
  /** The pages kept on this computer */
  api: NotionixApi
  server: DesktopServer
  local: DesktopLocalStore
  /** This app's version (x.y.z) */
  appVersion(): Promise<string>
  updates: DesktopUpdates
}

/** Address of a server as typed by a person: scheme added, path removed; null when invalid. */
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  return `${url.protocol}//${url.host}`
}

/** An account activation link (`https://server/activate/<key>`): its server and key; null otherwise. */
export function parseActivationLink(input: string): { url: string; token: string } | null {
  const text = input.trim()
  const match = /^(.*?)\/activate\/([A-Za-z0-9_-]{16,256})\/?$/.exec(text)
  if (!match) return null
  const url = normalizeServerUrl(match[1])
  return url ? { url, token: match[2] } : null
}

/** The desktop app offered for download by a server, as the web client shows it. */
export interface DesktopDownload {
  /** File name, e.g. notionix-1.0.0-universal.dmg */
  name: string
  version: string | null
  size: number
}

/** `GET /api/downloads` */
export interface DownloadsInfo {
  /** The latest app for Mac (Apple Silicon and Intel), served at /download/mac; or null */
  mac: DesktopDownload | null
  /**
   * Port of the plain HTTP site in front of the server (HTTPS deployments),
   * where the app can be downloaded before the computer knows the server's
   * certificate; null when there is none.
   */
  plainPort: number | null
}

/**
 * Where to download the Mac app: `direct` on the server's own address (for a
 * computer that already trusts it), `shared` the one to give a new person
 * (plain HTTP when the server is behind HTTPS with its own authority: the app
 * knows that authority, the browser does not yet).
 */
export function macDownloadUrls(
  origin: string,
  info: DownloadsInfo
): { direct: string; shared: string } | null {
  if (!info.mac) return null
  const direct = `${origin}/download/mac`
  const url = new URL(origin)
  const shared =
    url.protocol === 'https:' && info.plainPort
      ? `http://${url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname}${info.plainPort === 80 ? '' : `:${info.plainPort}`}/download/mac`
      : direct
  return { direct, shared }
}
