import { assetNameFromSrc } from '../../src/shared/assets'
import { displayValue, rowValue } from '../../src/shared/database'
import type { PageId, PublicPage } from '../../src/shared/types'
import type { Workspace } from './workspace'

/**
 * Published pages, read by anyone with their link: the published page and
 * its sub-pages, never anything else of the workspace.
 */
export class PublicPages {
  constructor(private readonly ws: Workspace) {}

  /** The published page of a link, or null for an unknown or withdrawn link. */
  rootOf(token: string): PageId | null {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
    const id = this.ws.pages.findByPublicToken(token)
    const page = id ? this.ws.pages.get(id) : null
    return page && !page.trashedAt ? page.id : null
  }

  /** Pages reachable through a link: the published one and its sub-pages (not in the trash). */
  reachable(rootId: PageId): Set<PageId> {
    const pages = this.ws.pages.list()
    const out = new Set<PageId>([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const p of pages)
        if (!p.trashedAt && p.parentId && out.has(p.parentId) && !out.has(p.id)) {
          out.add(p.id)
          grew = true
        }
    }
    return out
  }

  page(token: string, pageId?: string): PublicPage | null {
    const rootId = this.rootOf(token)
    if (!rootId) return null
    const id = pageId ?? rootId
    if (!this.reachable(rootId).has(id)) return null
    const page = this.ws.pages.get(id)!
    const root = this.ws.pages.get(rootId)!
    const children = this.ws.pages
      .list()
      .filter((p) => p.parentId === id && !p.trashedAt && p.kind !== 'synced' && !p.isTemplate)
      .sort((a, b) => a.position - b.position)
    let table: PublicPage['table'] = null
    if (page.kind === 'database') {
      const data = this.ws.databases.get(id)
      if (data) {
        const titles = new Map(this.ws.pages.list().map((p) => [p.id, p.title]))
        const props = data.schema.properties
        table = {
          columns: props.map((p) => p.name),
          rows: data.rows
            .filter((r) => !r.isTemplate)
            .map((r) => ({
              id: r.id,
              cells: props.map((p) => displayValue(p, rowValue(r, p), (x) => titles.get(x)))
            }))
        }
      }
    }
    return {
      id,
      title: page.title,
      icon: page.icon,
      cover: page.cover,
      kind: page.kind,
      content: page.content,
      children:
        page.kind === 'database'
          ? []
          : children.map((c) => ({ id: c.id, title: c.title, icon: c.icon })),
      table,
      root: { id: rootId, title: root.title }
    }
  }

  /** Whether an image or file is used by a page reachable through the link. */
  servesAsset(token: string, name: string): boolean {
    const rootId = this.rootOf(token)
    if (!rootId) return false
    for (const id of this.reachable(rootId)) {
      const page = this.ws.pages.get(id)
      if (!page) continue
      if (page.content.includes(name) || assetNameFromSrc(page.cover ?? '') === name) return true
    }
    return false
  }
}
