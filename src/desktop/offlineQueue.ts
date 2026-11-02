import type { Page, PageId, PagePatch, PageSummary } from '../shared/types'

/** A change of a server page made without network, sent when it is back. */
export type QueuedChange =
  | { kind: 'update'; id: PageId; patch: PagePatch; at: number }
  | { kind: 'move'; id: PageId; parentId: PageId | null; index: number; at: number }
  | { kind: 'trash'; id: PageId; at: number }

/** What the page itself shows of a change: content belongs to its shared document. */
const shown = (patch: PagePatch): PagePatch => {
  const { content: _content, ...rest } = patch
  void _content
  return rest
}

/**
 * Changes of the server's pages (title, icon, cover, options, place, trash)
 * made without network: kept on this computer, shown at once over what the
 * server last said, and sent in order when the network is back. Content is
 * not here: it travels in each page's shared document.
 */
export class OfflineQueue {
  private changes: QueuedChange[]
  private flushing: Promise<FlushReport> | null = null

  constructor(
    /** Where the queue is kept (per server and account) */
    private readonly key: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  ) {
    let saved: QueuedChange[] = []
    try {
      saved = JSON.parse(storage?.getItem(key) ?? '[]') as QueuedChange[]
    } catch {
      saved = []
    }
    this.changes = Array.isArray(saved) ? saved : []
  }

  get pending(): boolean {
    return this.changes.length > 0
  }

  list(): QueuedChange[] {
    return [...this.changes]
  }

  push(change: QueuedChange): void {
    this.changes.push(change)
    this.save()
  }

  /** Forgets what is about pages that are gone (removed for good, or an account switch). */
  clear(): void {
    this.changes = []
    this.save()
  }

  private save(): void {
    try {
      if (this.changes.length) this.storage?.setItem(this.key, JSON.stringify(this.changes))
      else this.storage?.removeItem(this.key)
    } catch {
      // Kept in memory until the app closes.
    }
  }

  /** The server's list of pages as it will be once the changes are sent. */
  overlayList(pages: PageSummary[]): PageSummary[] {
    if (!this.changes.length) return pages
    const byId = new Map(pages.map((p) => [p.id, { ...p }]))
    const childrenOf = (id: PageId): PageSummary[] =>
      [...byId.values()].filter((p) => p.parentId === id)
    for (const c of this.changes) {
      const page = byId.get(c.id)
      if (!page) continue
      if (c.kind === 'update') Object.assign(page, shown(c.patch), { updatedAt: c.at })
      else if (c.kind === 'trash') {
        const stack = [page]
        while (stack.length) {
          const p = stack.pop()!
          if (p.trashedAt === null) p.trashedAt = c.at
          stack.push(...childrenOf(p.id))
        }
      } else {
        const siblings = [...byId.values()]
          .filter((p) => p.parentId === c.parentId && p.id !== c.id && !p.trashedAt)
          .sort((a, b) => a.position - b.position)
        siblings.splice(Math.max(0, Math.min(c.index, siblings.length)), 0, page)
        page.parentId = c.parentId
        siblings.forEach((p, i) => (p.position = i))
      }
    }
    return [...byId.values()]
  }

  /** A page of the server as it will be once the changes are sent. */
  overlayPage<T extends Page | PageSummary>(page: T | null): T | null {
    if (!page || !this.changes.some((c) => c.id === page.id)) return page
    const [shownPage] = this.overlayList([page]) as T[]
    return { ...page, ...shownPage }
  }

  /**
   * Sends the changes in order. One the server refuses (the page is gone,
   * no right) is dropped and reported; the network gone again stops there.
   */
  flush(
    send: (change: QueuedChange) => Promise<void>,
    offline: (error: unknown) => boolean
  ): Promise<FlushReport> {
    this.flushing ??= (async () => {
      const report: FlushReport = { sent: 0, dropped: [] }
      try {
        while (this.changes.length) {
          const change = this.changes[0]
          try {
            await send(change)
            report.sent++
          } catch (e) {
            if (offline(e)) break
            report.dropped.push({ change, error: e instanceof Error ? e.message : String(e) })
          }
          this.changes.shift()
          this.save()
        }
      } finally {
        this.flushing = null
      }
      return report
    })()
    return this.flushing
  }
}

export interface FlushReport {
  sent: number
  dropped: { change: QueuedChange; error: string }[]
}
