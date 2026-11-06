import type { PageId, PageSummary } from '../shared/types'

/**
 * Like OneDrive: a page is kept on this computer (readable and writable
 * without network), or online only. Chosen per workspace, and per page for
 * a page and what is under it.
 */
export type Availability = 'keep' | 'online'

/** This device's choices (per server and account). */
export interface OfflineSettings {
  /** Per workspace; absent: kept */
  workspaces: Record<string, Availability>
  /** Per page, for it and its sub-pages; absent: as its parent (or its workspace) */
  pages: Record<PageId, Availability>
}

/** What was kept of a page the last time. */
export interface KeptPage {
  /** Its version then (`versionOf`): kept again when it changes */
  v: number
  /** When it was kept */
  at: number
  /** About how much room it takes here (its answers and its files) */
  bytes: number
}

/** Per workspace, the pages kept. */
export type KeptPages = Record<string, Record<PageId, KeptPage>>

/** Where a page's availability comes from. */
export type AvailabilitySource = 'page' | 'parent' | 'workspace' | 'always'

export const emptySettings = (): OfflineSettings => ({ workspaces: {}, pages: {} })

const isAvailability = (v: unknown): v is Availability => v === 'keep' || v === 'online'

const choices = (v: unknown): Record<string, Availability> => {
  const out: Record<string, Availability> = {}
  if (v && typeof v === 'object')
    for (const [k, value] of Object.entries(v)) if (isAvailability(value)) out[k] = value
  return out
}

/** Settings read back from storage; anything unknown is dropped. */
export function parseSettings(text: string | null): OfflineSettings {
  try {
    const v = JSON.parse(text ?? '{}') as { workspaces?: unknown; pages?: unknown }
    return { workspaces: choices(v?.workspaces), pages: choices(v?.pages) }
  } catch {
    return emptySettings()
  }
}

/** The kept pages read back from storage; anything unknown is dropped. */
export function parseKept(text: string | null): KeptPages {
  const out: KeptPages = {}
  try {
    const v = JSON.parse(text ?? '{}') as unknown
    if (!v || typeof v !== 'object') return out
    for (const [ws, pages] of Object.entries(v)) {
      if (!pages || typeof pages !== 'object') continue
      const kept: Record<PageId, KeptPage> = {}
      for (const [id, k] of Object.entries(pages as Record<string, Partial<KeptPage>>))
        if (k && typeof k.v === 'number' && typeof k.at === 'number')
          kept[id] = { v: k.v, at: k.at, bytes: typeof k.bytes === 'number' ? k.bytes : 0 }
      out[ws] = kept
    }
  } catch {
    // Kept again.
  }
  return out
}

/**
 * Whether a page is kept, from its own choice, its nearest parent's, or its
 * workspace's (kept by default).
 */
export function availabilityOf(
  pageId: PageId,
  byId: ReadonlyMap<PageId, Pick<PageSummary, 'id' | 'parentId'>>,
  workspace: string,
  settings: OfflineSettings
): { value: Availability; source: Exclude<AvailabilitySource, 'always'> } {
  let id: PageId | null = pageId
  const seen = new Set<PageId>()
  while (id !== null && !seen.has(id)) {
    seen.add(id)
    const own = settings.pages[id]
    if (own) return { value: own, source: id === pageId ? 'page' : 'parent' }
    id = byId.get(id)?.parentId ?? null
  }
  return { value: settings.workspaces[workspace] ?? 'keep', source: 'workspace' }
}

/**
 * Pages kept whatever the choices: the person's private pages and what is
 * under them, their favorites, and the pages they opened lately.
 */
export function alwaysKept(
  pages: readonly PageSummary[],
  me: string,
  recent: Iterable<PageId>
): Set<PageId> {
  const live = pages.filter((p) => !p.trashedAt)
  const children = childrenByParent(live)
  const out = new Set<PageId>()
  const under = (id: PageId): void => {
    if (out.has(id)) return
    out.add(id)
    for (const c of children.get(id) ?? []) under(c.id)
  }
  for (const p of live)
    if (p.parentId === null && p.access === 'restricted' && p.createdBy === me) under(p.id)
  for (const p of live) if (p.favorite) out.add(p.id)
  const known = new Set(live.map((p) => p.id))
  for (const id of recent) if (known.has(id)) out.add(id)
  return out
}

/** The pages of a workspace to keep on this computer. */
export function wantedPages(
  pages: readonly PageSummary[],
  workspace: string,
  settings: OfflineSettings,
  always: ReadonlySet<PageId>
): Set<PageId> {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const out = new Set<PageId>()
  for (const p of pages) {
    if (p.trashedAt) continue
    if (always.has(p.id) || availabilityOf(p.id, byId, workspace, settings).value === 'keep')
      out.add(p.id)
  }
  return out
}

export function childrenByParent(pages: readonly PageSummary[]): Map<PageId, PageSummary[]> {
  const out = new Map<PageId, PageSummary[]>()
  for (const p of pages) {
    if (p.parentId === null) continue
    const list = out.get(p.parentId)
    if (list) list.push(p)
    else out.set(p.parentId, [p])
  }
  return out
}

/**
 * A page's version, for knowing whether to keep it again: when it changed,
 * and for a database, when one of its rows did (they are in its answer).
 */
export function versionOf(page: PageSummary, children: ReadonlyMap<PageId, PageSummary[]>): number {
  let v = page.updatedAt
  if (page.kind === 'database')
    for (const row of children.get(page.id) ?? [])
      if (!row.trashedAt) v = Math.max(v, row.updatedAt)
  return v
}

/**
 * What to do in a workspace: the pages to keep (again), those first that are
 * always kept, then the latest changed; and those kept before that are no
 * longer wanted (set to online only, deleted, or gone from the person's view).
 */
export function planWorkspace(
  pages: readonly PageSummary[],
  wanted: ReadonlySet<PageId>,
  kept: Readonly<Record<PageId, KeptPage>>,
  always: ReadonlySet<PageId>
): { stale: PageSummary[]; evicted: PageId[] } {
  const children = childrenByParent(pages)
  const stale = pages
    .filter((p) => wanted.has(p.id) && (kept[p.id]?.v ?? -1) < versionOf(p, children))
    .sort(
      (a, b) => Number(always.has(b.id)) - Number(always.has(a.id)) || b.updatedAt - a.updatedAt
    )
  const evicted = Object.keys(kept).filter((id) => !wanted.has(id))
  return { stale, evicted }
}
