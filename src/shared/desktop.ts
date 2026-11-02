import type { SessionUser } from './collab'
import type { NotionixApi } from './types'

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
  /** Signs out and unlinks the server; the pages on this computer stay */
  logout(): Promise<void>
  /** Sends a request of the web client's API (`/api/…`) to the server */
  request(path: string, init: ProxyRequest): Promise<ProxyResponse>
  /** The session token, for the real-time connection */
  token(): Promise<string | null>
}

/** What the desktop app's preload gives the page. */
export interface DesktopBridge {
  /** The pages kept on this computer */
  api: NotionixApi
  server: DesktopServer
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
