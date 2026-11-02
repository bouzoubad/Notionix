import type { DesktopLocalStore } from '../shared/desktop'
import type { NotionixApi, PageAccess, PageId, PageTreeNode } from '../shared/types'

/** A file of a page (image, attachment) named by its content. */
const ASSET = /notionix-asset:\/\/file\/([0-9a-f]{64}\.[a-z0-9]+)/g

/** The names of the files a tree of pages uses. */
export function assetsOf(nodes: PageTreeNode[]): string[] {
  const names = new Set<string>()
  for (const n of nodes)
    for (const text of [n.content, n.cover ?? '', n.properties ?? ''])
      for (const m of text.matchAll(ASSET)) names.add(m[1])
  return [...names]
}

const PENDING_KEY = 'notionix-pending-parents'

/**
 * Sub-pages written without network under a page of the server wait here at
 * the top level; where they go once sent (local id -> server parent id).
 */
export const pendingParents = {
  all(): Record<PageId, PageId> {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as Record<PageId, PageId>
    } catch {
      return {}
    }
  },
  set(id: PageId, parentId: PageId): void {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ ...this.all(), [id]: parentId }))
    } catch {
      // Without storage the page is sent as a private page.
    }
  },
  remove(id: PageId): void {
    const all = this.all()
    delete all[id]
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(all))
    } catch {
      // Nothing kept.
    }
  }
}

export interface ServerTarget {
  /** Stores a file on the server under its name (checked against its bytes) */
  putAsset(name: string, bytes: Uint8Array): Promise<void>
  /** Creates the pages with their ids, under `parentId` */
  adopt(parentId: PageId | null, nodes: PageTreeNode[], access?: PageAccess): Promise<unknown>
  /** The pages the server has now (never from what was kept: throws when out of reach) */
  ids(): Promise<Set<PageId>>
  /** Whether an error means the server is out of reach (then everything waits) */
  offline(error: unknown): boolean
}

/** Pages sent in one request at most (the server takes 4 MB). */
const MAX_BATCH = 3 * 1024 * 1024

/** The sub-tree of `nodes` under `rootId`, rooted there. */
const subtree = (nodes: PageTreeNode[], rootId: PageId): PageTreeNode[] => {
  const inside = new Set([rootId])
  const out: PageTreeNode[] = []
  for (const n of nodes)
    if (n.id === rootId) out.push({ ...n, parentId: null })
    else if (n.parentId && inside.has(n.parentId)) {
      inside.add(n.id)
      out.push(n)
    }
  return out
}

/**
 * Sends a tree, in pieces when it is big: the root, then each sub-tree under
 * it. What the server already has (an earlier attempt cut short) is skipped.
 */
async function sendTree(
  server: ServerTarget,
  nodes: PageTreeNode[],
  parentId: PageId | null,
  access: PageAccess | undefined,
  known: Set<PageId>
): Promise<void> {
  const [root] = nodes
  if (!known.has(root.id)) {
    if (new TextEncoder().encode(JSON.stringify(nodes)).length <= MAX_BATCH) {
      await server.adopt(parentId, nodes, access)
      return
    }
    await server.adopt(parentId, [root], access)
  }
  for (const child of nodes.filter((n) => n.parentId === root.id))
    await sendTree(server, subtree(nodes, child.id), root.id, undefined, known)
}

export interface SendReport {
  sent: PageId[]
  failed: { id: PageId; title: string; error: string }[]
}

/**
 * Sends the pages of this computer to the server, each top-level page with
 * everything under it: files first, then the pages with the same ids, private
 * (or under the page of the server they were written in). Once there, they
 * are deleted here (a copy stays in a file). Stops at the first sign the
 * server is out of reach: what is left goes next time.
 */
export async function sendLocalPages(
  local: {
    pages: Pick<NotionixApi['pages'], 'list'> & {
      duplicate: (id: PageId) => Promise<{ id: PageId }>
    }
  },
  store: DesktopLocalStore,
  server: ServerTarget,
  /** Pages open in the editor wait: they are sent once closed */
  busy: (id: PageId) => boolean = () => false,
  /** Told as soon as a page is on the server (and gone from here) */
  onSent: (id: PageId) => void = () => undefined
): Promise<SendReport> {
  const report: SendReport = { sent: [], failed: [] }
  const roots = (await local.pages.list()).filter((p) => p.parentId === null && !p.trashedAt)
  const parents = pendingParents.all()
  for (const root of roots) {
    try {
      const nodes = await store.tree(root.id)
      if (nodes.length === 0 || nodes.some((n) => busy(n.id))) continue
      for (const name of assetsOf(nodes)) {
        const bytes = await store.asset(name)
        if (bytes) await server.putAsset(name, bytes)
      }
      const parentId = parents[root.id] ?? null
      const known = await server.ids()
      try {
        await sendTree(server, nodes, parentId, parentId ? undefined : 'restricted', known)
      } catch (e) {
        // The page it was written in is gone, or no longer editable: sent as a private page.
        if (!parentId || server.offline(e) || (await server.ids()).has(root.id)) throw e
        await sendTree(server, nodes, null, 'restricted', known)
      }
      // Deleted here only once the server has all of it.
      const received = await server.ids()
      const missing = nodes.find((n) => !received.has(n.id))
      if (missing) throw new Error(`Page not received: ${missing.title || missing.id}`)
      // Changed here while it was being sent: that version is kept as a copy, sent next time.
      if (JSON.stringify(await store.tree(root.id)) !== JSON.stringify(nodes)) {
        const copy = await local.pages.duplicate(root.id)
        if (parentId) pendingParents.set(copy.id, parentId)
      }
      await store.forget(root.id)
      pendingParents.remove(root.id)
      report.sent.push(root.id)
      onSent(root.id)
    } catch (e) {
      if (server.offline(e)) break
      report.failed.push({
        id: root.id,
        title: root.title,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return report
}
