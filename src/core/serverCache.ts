import { DatabaseSync } from 'node:sqlite'

/**
 * Server operations that only read: the desktop app keeps their last answer,
 * so that the team's pages stay readable when the server cannot be reached.
 */
export const CACHED_CALLS: ReadonlySet<string> = new Set([
  'pages.list',
  'pages.elsewhere',
  'pages.get',
  'pages.backlinks',
  'pages.shares',
  'pages.versions',
  'pages.version',
  'pages.stats',
  'people.list',
  'people.groups',
  'comments.list',
  'inbox.list',
  'inbox.activity',
  'databases.get',
  'databases.getRow',
  'databases.recurrences'
])

/**
 * Requests other than operations whose answer is kept too: they are about the
 * account, the same in every workspace (kept once, read from any of them).
 */
export const CACHED_PATHS: ReadonlySet<string> = new Set([
  '/api/me',
  '/api/workspaces',
  '/api/emojis',
  '/api/me/appearance'
])
/** Stands for the workspace in the key of an answer that is the same in all of them. */
const ANY_WORKSPACE = '*'

/**
 * Last answers of the server, per server, workspace and request. Only read
 * when the server is out of reach; cleared when the person signs out.
 */
export class ServerCache {
  private readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`CREATE TABLE IF NOT EXISTS answers (
      key TEXT PRIMARY KEY,
      body BLOB NOT NULL,
      at INTEGER NOT NULL
    )`)
  }

  /** Key of a request: the same operation with the same arguments on the same workspace. */
  static key(server: string, workspace: string, request: string): string {
    return `${server}\n${workspace}\n${request}`
  }

  get(key: string): { body: Uint8Array; at: number } | null {
    const row = this.db.prepare('SELECT body, at FROM answers WHERE key = ?').get(key) as
      { body: Uint8Array; at: number } | undefined
    return row ? { body: new Uint8Array(row.body), at: row.at } : null
  }

  put(key: string, body: Uint8Array, at = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO answers (key, body, at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, at = excluded.at`
      )
      .run(key, body, at)
  }

  clear(): void {
    this.db.exec('DELETE FROM answers')
  }

  close(): void {
    this.db.close()
  }
}

/**
 * The key under which an operation's answer is kept, or null when it is not
 * kept (a change, or a request that is not an operation).
 */
export function cacheKeyOf(
  server: string,
  workspace: string,
  method: string,
  path: string,
  body: string | null
): string | null {
  if (method === 'GET' && CACHED_PATHS.has(path))
    return ServerCache.key(server, ANY_WORKSPACE, path)
  if (method !== 'POST' || path !== '/api/rpc' || body === null) return null
  try {
    const call = JSON.parse(body) as { method?: unknown; args?: unknown }
    if (typeof call.method !== 'string' || !CACHED_CALLS.has(call.method)) return null
    return ServerCache.key(server, workspace, `${call.method}\n${JSON.stringify(call.args ?? [])}`)
  } catch {
    return null
  }
}
