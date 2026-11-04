/**
 * Minimal client of Notion's public API (https://developers.notion.com), used
 * by the migration: read-only calls, paced under Notion's limit (about three
 * requests a second) and retried when Notion asks to slow down or fails for a
 * moment.
 */

export const NOTION_VERSION = '2026-03-11'
const BASE = 'https://api.notion.com/v1'

export class NotionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export interface NotionClientOptions {
  token: string
  fetch?: typeof fetch
  /** Least time between two requests */
  intervalMs?: number
  /** Waits (tests replace it) */
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

interface ListResponse<T> {
  results: T[]
  has_more: boolean
  next_cursor: string | null
}

const RETRIED = new Set([409, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 8

export class NotionClient {
  private readonly fetch: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly intervalMs: number
  private last = 0
  /** Requests made, for the report */
  requests = 0

  constructor(private readonly options: NotionClientOptions) {
    this.fetch = options.fetch ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.intervalMs = options.intervalMs ?? 340
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const wait = this.last + this.intervalMs - Date.now()
      if (wait > 0) await this.sleep(wait)
      this.last = Date.now()
      this.requests += 1
      let res: Response
      try {
        res = await this.fetch(`${BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            'Notion-Version': NOTION_VERSION,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60_000)
        })
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS) throw e
        await this.sleep(backoff(attempt))
        continue
      }
      if (res.ok) return (await res.json()) as T
      const text = await res.text()
      let code = String(res.status)
      let message = text.slice(0, 300)
      try {
        const json = JSON.parse(text) as { code?: string; message?: string }
        code = json.code ?? code
        message = json.message ?? message
      } catch {
        // not JSON
      }
      if (RETRIED.has(res.status) && attempt < MAX_ATTEMPTS) {
        const after = Number(res.headers.get('retry-after'))
        const ms = Number.isFinite(after) && after > 0 ? after * 1000 : backoff(attempt)
        this.options.log?.(`Notion ${res.status} (${code}) sur ${path}, nouvel essai dans ${ms} ms`)
        await this.sleep(ms)
        continue
      }
      throw new NotionApiError(res.status, code, `${method} ${path} : ${message}`)
    }
  }

  /** Every result of a paginated list (GET with start_cursor, POST with it in the body). */
  async all<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T[]> {
    const out: T[] = []
    let cursor: string | null = null
    do {
      let page: ListResponse<T>
      if (method === 'GET') {
        const sep = path.includes('?') ? '&' : '?'
        const query = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`
        page = await this.request<ListResponse<T>>('GET', `${path}${sep}${query}`)
      } else {
        page = await this.request<ListResponse<T>>('POST', path, {
          ...body,
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {})
        })
      }
      out.push(...page.results)
      cursor = page.has_more ? page.next_cursor : null
    } while (cursor)
    return out
  }
}

const backoff = (attempt: number): number => Math.min(60_000, 1000 * 2 ** (attempt - 1))
