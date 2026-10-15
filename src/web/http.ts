import { WORKSPACE_HEADER } from '../shared/collab'
import { currentWorkspace } from './workspace'

/** Header that marks the web client's requests (the server refuses cookie-only changes). */
const CLIENT = { 'X-Notionix-Client': 'web' }

/** Server reply other than success; 401 means the session is over. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

let onUnauthorized: () => void = () => undefined

/** Called once when the server says the session has ended. */
export function whenSignedOut(handler: () => void): void {
  onUnauthorized = handler
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res
  let message = `Erreur ${res.status}`
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) message = body.error
  } catch {
    // not JSON
  }
  if (res.status === 401) onUnauthorized()
  throw new ServerError(res.status, message)
}

export async function request(
  path: string,
  init: { method?: string; json?: unknown; body?: BodyInit; type?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT, [WORKSPACE_HEADER]: currentWorkspace() }
  if (init.json !== undefined) headers['Content-Type'] = 'application/json'
  else if (init.type) headers['Content-Type'] = init.type
  const res = await fetch(path, {
    method: init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body
  })
  return check(res)
}

export async function json<T>(path: string, init: Parameters<typeof request>[1] = {}): Promise<T> {
  return (await (await request(path, init)).json()) as T
}

/** Runs one workspace operation on the server. */
export async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const { result } = await json<{ result: T }>('/api/rpc', { json: { method, args } })
  return result
}
