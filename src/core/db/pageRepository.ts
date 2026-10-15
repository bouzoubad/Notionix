import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'crypto'
import type {
  Page,
  PageAccess,
  PageId,
  PageOptions,
  PagePatch,
  PageShare,
  PageSummary,
  SearchHit
} from '../../shared/types'
import type { ShareRow } from '../access'
import { docLinks, docToText } from './text'
import { displayValue, parseRowProperties, parseSchema } from '../../shared/database'

interface Row {
  id: string
  parent_id: string | null
  title: string
  icon: string | null
  cover: string | null
  content: string
  position: number
  favorite: number
  trashed_at: number | null
  created_at: number
  updated_at: number
  version: number
  kind: string
  is_template: number
  created_by: string | null
  updated_by: string | null
  access: string
  is_space: number
  options: string | null
  public_token: string | null
}

const SUMMARY_COLUMNS =
  'id, parent_id, title, icon, cover, position, favorite, trashed_at, created_at, updated_at, version, kind, is_template, created_by, updated_by, access, is_space, options, public_token'

const ACCESSES: PageAccess[] = ['inherit', 'workspace', 'restricted']
const SHARE_LEVELS: PageShare['level'][] = ['read', 'comment', 'edit', 'full']

/** Page options as stored; unknown keys and values are dropped. */
export function parseOptions(raw: unknown): PageOptions {
  let input: unknown = raw
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  const o = input as Record<string, unknown>
  const out: PageOptions = {}
  if (o.fullWidth === true) out.fullWidth = true
  if (o.smallText === true) out.smallText = true
  if (o.font === 'serif' || o.font === 'mono') out.font = o.font
  if (o.locked === true) out.locked = true
  return out
}

const EMPTY_DOC = '{"type":"doc","content":[{"type":"paragraph"}]}'

export interface ImportNode {
  id: PageId
  /** Parent page id, or null for a top-level node */
  parentId: PageId | null
  title: string
  /** Serialised ProseMirror document */
  content: string
  /** Provenance such as 'notion:<id>'; unique across pages */
  source: string | null
  /** Already imported earlier: nothing is written */
  existing: boolean
  kind?: 'page' | 'database'
  /** database schema (JSON), for kind 'database' */
  dbSchema?: string | null
  /** database row values (JSON) */
  properties?: string | null
  /** database template row */
  isTemplate?: boolean
}

const toSummary = (r: Omit<Row, 'content'>): PageSummary => ({
  id: r.id,
  parentId: r.parent_id,
  title: r.title,
  icon: r.icon,
  cover: r.cover,
  position: r.position,
  favorite: r.favorite === 1,
  trashedAt: r.trashed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  version: r.version,
  kind: r.kind === 'database' ? 'database' : 'page',
  isTemplate: r.is_template === 1,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  access: ACCESSES.includes(r.access as PageAccess) ? (r.access as PageAccess) : 'inherit',
  isSpace: r.is_space === 1,
  options: parseOptions(r.options),
  publicToken: r.public_token,
  level: 'full'
})

const toPage = (r: Row): Page => ({ ...toSummary(r), content: r.content })

export class PageRepository {
  private txDepth = 0
  /**
   * Account making the current changes, recorded as creator and last editor.
   * Set around each server call (calls run synchronously, one at a time).
   */
  actor: string | null = null

  constructor(
    readonly db: DatabaseSync,
    readonly now: () => number = Date.now
  ) {}

  list(): PageSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM pages ORDER BY position`)
      .all() as unknown as Omit<Row, 'content'>[]
    return rows.map(toSummary)
  }

  get(id: PageId): Page | null {
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as Row | undefined
    return row ? toPage(row) : null
  }

  /** Runs `fn` on behalf of `actor`. */
  as<T>(actor: string | null, fn: () => T): T {
    const previous = this.actor
    this.actor = actor
    try {
      return fn()
    } finally {
      this.actor = previous
    }
  }

  /** A new page; `access` sets who sees a top-level page ('restricted': private). */
  create(parentId: PageId | null, access: PageAccess = 'inherit'): Page {
    const id = randomUUID()
    const t = this.now()
    const last = this.db
      .prepare('SELECT MAX(position) AS p FROM pages WHERE parent_id IS ?')
      .get(parentId) as { p: number | null }
    this.db
      .prepare(
        'INSERT INTO pages (id, parent_id, position, created_at, updated_at, created_by, updated_by, access) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, parentId, (last.p ?? 0) + 1, t, t, this.actor, this.actor, access)
    this.reindex(id)
    return this.get(id)!
  }

  update(id: PageId, patch: PagePatch): PageSummary {
    const sets: string[] = []
    const values: (string | number | null)[] = []
    const set = (column: string, value: string | number | null): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.title !== undefined) set('title', patch.title)
    if (patch.icon !== undefined) set('icon', patch.icon)
    if (patch.cover !== undefined) set('cover', patch.cover)
    if (patch.content !== undefined) set('content', patch.content)
    if (patch.favorite !== undefined) set('favorite', patch.favorite ? 1 : 0)
    if (patch.options !== undefined) set('options', JSON.stringify(parseOptions(patch.options)))
    if (sets.length === 0) return this.summary(id)
    sets.push('updated_at = ?', 'updated_by = ?', 'version = version + 1')
    values.push(this.now(), this.actor, id)
    const res = this.db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    if (res.changes === 0) throw new Error(`Page not found: ${id}`)
    if (patch.title !== undefined || patch.content !== undefined) this.reindex(id)
    return this.summary(id)
  }

  /** Place `id` under `parentId` at `index` among its non-trashed siblings. */
  move(id: PageId, parentId: PageId | null, index: number): void {
    if (parentId !== null && (parentId === id || this.descendantIds(id).includes(parentId))) {
      throw new Error('Cannot move a page into itself or its descendants')
    }
    const current = this.summary(id)
    const parent = parentId ? this.summary(parentId) : null
    if (parent?.kind === 'database' && current.parentId !== parentId) {
      throw new Error('A page cannot be moved into a database; add a row instead')
    }
    const siblings = (
      this.db
        .prepare(
          'SELECT id, position FROM pages WHERE parent_id IS ? AND id != ? AND trashed_at IS NULL ORDER BY position'
        )
        .all(parentId, id) as { id: string; position: number }[]
    ).map((s) => s.position)
    const i = Math.max(0, Math.min(index, siblings.length))
    const before = siblings[i - 1]
    const after = siblings[i]
    const position =
      before === undefined && after === undefined
        ? 1
        : before === undefined
          ? after - 1
          : after === undefined
            ? before + 1
            : (before + after) / 2
    this.db
      .prepare(
        'UPDATE pages SET parent_id = ?, position = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?'
      )
      .run(parentId, position, this.now(), this.actor, id)
  }

  // -------------------------------------------------------------------------
  // Access and sharing

  setAccess(id: PageId, access: PageAccess): PageSummary {
    if (!ACCESSES.includes(access)) throw new Error('Accès inconnu.')
    this.touch(id, 'access = ?', access)
    return this.summary(id)
  }

  /** Shows a top-level page as a teamspace section in the sidebar. */
  setSpace(id: PageId, isSpace: boolean): PageSummary {
    if (isSpace && this.summary(id).parentId !== null)
      throw new Error('Seule une page de premier niveau peut devenir un espace.')
    this.touch(id, 'is_space = ?', isSpace ? 1 : 0)
    return this.summary(id)
  }

  shares(id: PageId): PageShare[] {
    return (
      this.db
        .prepare('SELECT user_id, level FROM page_shares WHERE page_id = ? ORDER BY rowid')
        .all(id) as { user_id: string; level: PageShare['level'] }[]
    ).map((r) => ({ userId: r.user_id, level: r.level }))
  }

  allShares(): ShareRow[] {
    return (
      this.db.prepare('SELECT page_id, user_id, level FROM page_shares').all() as {
        page_id: string
        user_id: string
        level: PageShare['level']
      }[]
    ).map((r) => ({ pageId: r.page_id, userId: r.user_id, level: r.level }))
  }

  /** Shares a page (and its sub-pages) with a person; a null level stops sharing. */
  setShare(id: PageId, userId: string, level: PageShare['level'] | null): void {
    this.summary(id)
    if (level === null) {
      this.db.prepare('DELETE FROM page_shares WHERE page_id = ? AND user_id = ?').run(id, userId)
      return
    }
    if (!SHARE_LEVELS.includes(level)) throw new Error('Niveau de partage inconnu.')
    this.db
      .prepare(
        `INSERT INTO page_shares (page_id, user_id, level) VALUES (?, ?, ?)
         ON CONFLICT(page_id, user_id) DO UPDATE SET level = excluded.level`
      )
      .run(id, userId, level)
  }

  /** Publishes a page with a public read-only token, or unpublishes it (null). */
  setPublicToken(id: PageId, token: string | null): PageSummary {
    this.touch(id, 'public_token = ?', token)
    return this.summary(id)
  }

  findByPublicToken(token: string): PageId | null {
    const row = this.db.prepare('SELECT id FROM pages WHERE public_token = ?').get(token) as
      { id: string } | undefined
    return row?.id ?? null
  }

  /** Pages whose content links to `id` (links, mentions, link-to-page blocks). */
  backlinks(id: PageId): PageSummary[] {
    const ids = this.db
      .prepare(
        `SELECT l.from_id AS id FROM page_links l JOIN pages p ON p.id = l.from_id
         WHERE l.to_id = ? AND l.from_id != ? AND p.trashed_at IS NULL`
      )
      .all(id, id) as { id: string }[]
    return ids.map((r) => this.summary(r.id))
  }

  private touch(id: PageId, assignment: string, value: string | number | null): void {
    const res = this.db
      .prepare(
        `UPDATE pages SET ${assignment}, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`
      )
      .run(value, this.now(), this.actor, id)
    if (res.changes === 0) throw new Error(`Page not found: ${id}`)
  }

  /** Trash the page and its whole subtree with one shared timestamp. */
  trash(id: PageId): void {
    const ids = [id, ...this.descendantIds(id)]
    const t = this.now()
    this.inTransaction(() => {
      const stmt = this.db.prepare(
        'UPDATE pages SET trashed_at = ?, favorite = 0, version = version + 1 WHERE id = ? AND trashed_at IS NULL'
      )
      ids.forEach((x) => stmt.run(t, x))
    })
  }

  /** Restore the subtree trashed together with `id`; re-root it when its parent is still trashed. */
  restore(id: PageId): void {
    const page = this.summary(id)
    if (page.trashedAt === null) return
    const parent = page.parentId ? this.summary(page.parentId) : null
    this.inTransaction(() => {
      this.db
        .prepare(
          'UPDATE pages SET trashed_at = NULL, version = version + 1 WHERE trashed_at = ? AND id IN (' +
            [id, ...this.descendantIds(id)].map(() => '?').join(',') +
            ')'
        )
        .run(page.trashedAt, ...[id, ...this.descendantIds(id)])
      if (parent && parent.trashedAt !== null) {
        this.db.prepare('UPDATE pages SET parent_id = NULL WHERE id = ?').run(id)
      }
    })
  }

  deleteForever(id: PageId): void {
    const ids = [id, ...this.descendantIds(id)]
    this.inTransaction(() => {
      const fts = this.db.prepare('DELETE FROM page_fts WHERE id = ?')
      ids.forEach((x) => fts.run(x))
      this.db.prepare('DELETE FROM pages WHERE id = ?').run(id)
    })
  }

  duplicate(id: PageId): Page {
    const src = this.get(id)
    if (!src) throw new Error(`Page not found: ${id}`)
    return this.inTransaction(() => this.cloneTree(src, src.parentId, `${src.title} (copie)`))
  }

  search(query: string, limit = 20): SearchHit[] {
    const match = query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, '""')}"*`)
      .join(' ')
    if (!match) return []
    const rows = this.db
      .prepare(
        `SELECT f.id AS id, f.title AS title, p.icon AS icon,
                snippet(page_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet
         FROM page_fts f JOIN pages p ON p.id = f.id
         WHERE page_fts MATCH ? AND p.trashed_at IS NULL
         ORDER BY rank LIMIT ?`
      )
      .all(match, limit) as unknown as SearchHit[]
    return rows
  }

  /** Id of the page previously imported from `source`, trashed or not. */
  findIdBySource(source: string): PageId | undefined {
    const row = this.db.prepare('SELECT id FROM pages WHERE source = ?').get(source) as
      { id: string } | undefined
    return row?.id
  }

  /**
   * Inserts imported pages in one transaction. Nodes must list a parent before
   * its children. Top-level nodes (no parent) go under a new container page
   * titled `containerTitle`, created only when at least one node is new.
   */
  importNodes(
    nodes: ImportNode[],
    containerTitle: string
  ): { created: number; containerId: PageId | null } {
    return this.inTransaction(() => {
      let created = 0
      let containerId: PageId | null = null
      const insert = this.db.prepare(
        `INSERT INTO pages (id, parent_id, title, content, position, created_at, updated_at, source, kind, db_schema, properties, is_template, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const nextPosition = new Map<PageId | null, number>()
      const position = (parent: PageId | null): number => {
        let next = nextPosition.get(parent)
        if (next === undefined) {
          const last = this.db
            .prepare('SELECT MAX(position) AS p FROM pages WHERE parent_id IS ?')
            .get(parent) as { p: number | null }
          next = (last.p ?? 0) + 1
        }
        nextPosition.set(parent, next + 1)
        return next
      }
      const t = this.now()
      for (const node of nodes) {
        if (node.existing) continue
        let parentId = node.parentId
        if (parentId === null) {
          if (containerId === null) {
            containerId = randomUUID()
            insert.run(
              containerId,
              null,
              containerTitle,
              EMPTY_DOC,
              position(null),
              t,
              t,
              null,
              'page',
              null,
              null,
              0,
              this.actor,
              this.actor
            )
            this.reindex(containerId)
            created += 1
          }
          parentId = containerId
        }
        insert.run(
          node.id,
          parentId,
          node.title,
          node.content,
          position(parentId),
          t,
          t,
          node.source,
          node.kind ?? 'page',
          node.dbSchema ?? null,
          node.properties ?? null,
          node.isTemplate ? 1 : 0,
          this.actor,
          this.actor
        )
        this.reindex(node.id)
        created += 1
      }
      return { created, containerId }
    })
  }

  private cloneTree(src: Page, parentId: PageId | null, title: string): Page {
    const copy = this.create(parentId)
    this.db
      .prepare(
        `UPDATE pages SET (icon, cover, kind, db_schema, properties, is_template, options) =
           (SELECT icon, cover, kind, db_schema, properties, is_template, options FROM pages WHERE id = ?)
         WHERE id = ?`
      )
      .run(src.id, copy.id)
    this.update(copy.id, { title, content: src.content })
    const children = this.db
      .prepare('SELECT id FROM pages WHERE parent_id = ? AND trashed_at IS NULL ORDER BY position')
      .all(src.id) as { id: string }[]
    for (const c of children) this.cloneTree(this.get(c.id)!, copy.id, this.get(c.id)!.title)
    return this.get(copy.id)!
  }

  summary(id: PageId): PageSummary {
    const row = this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM pages WHERE id = ?`).get(id) as
      Omit<Row, 'content'> | undefined
    if (!row) throw new Error(`Page not found: ${id}`)
    return toSummary(row)
  }

  private descendantIds(id: PageId): PageId[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM pages WHERE parent_id = ?
           UNION ALL SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id
         ) SELECT id FROM sub`
      )
      .all(id) as { id: string }[]
    return rows.map((r) => r.id)
  }

  /** Search text: title and body, plus property values for a database row. */
  reindex(id: PageId): void {
    const row = this.db
      .prepare(
        `SELECT p.title, p.content, p.properties, d.db_schema AS schema
         FROM pages p LEFT JOIN pages d ON d.id = p.parent_id AND d.kind = 'database'
         WHERE p.id = ?`
      )
      .get(id) as
      | { title: string; content: string; properties: string | null; schema: string | null }
      | undefined
    if (!row) return
    let body = docToText(row.content)
    if (row.schema) {
      const schema = parseSchema(row.schema)
      const values = parseRowProperties(row.properties, schema)
      const extra = schema.properties
        .filter((p) => p.type !== 'relation')
        .map((p) => displayValue(p, values[p.id] ?? null))
        .filter(Boolean)
      if (extra.length) body = `${extra.join(' ')} ${body}`
    }
    this.db.prepare('DELETE FROM page_fts WHERE id = ?').run(id)
    this.db
      .prepare('INSERT INTO page_fts (id, title, body) VALUES (?, ?, ?)')
      .run(id, row.title, body)
    this.db.prepare('DELETE FROM page_links WHERE from_id = ?').run(id)
    const link = this.db.prepare('INSERT OR IGNORE INTO page_links (from_id, to_id) VALUES (?, ?)')
    for (const to of docLinks(row.content)) link.run(id, to)
  }

  /** Runs `fn` atomically; nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    return this.inTransaction(fn)
  }

  private inTransaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth += 1
      try {
        return fn()
      } finally {
        this.txDepth -= 1
      }
    }
    this.db.exec('BEGIN')
    this.txDepth = 1
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    } finally {
      this.txDepth = 0
    }
  }
}
