import type { DatabaseData, NewRow, PageId, PageSummary, RowData } from '../../shared/types'
import {
  convertProperty,
  isComputed,
  defaultSchema,
  normalizeValue,
  parseRowProperties,
  parseSchema,
  type DatabaseRow,
  type DatabaseSchema,
  type PropertyType,
  type PropertyValue
} from '../../shared/database'
import type { PageRepository } from './pageRepository'
import { computeDatabase, type DatabaseSource } from '../../shared/computed'

interface RowRecord {
  id: string
  title: string
  icon: string | null
  cover: string | null
  properties: string | null
  is_template: number
  position: number
  created_at: number
  updated_at: number
}

const ROW_COLUMNS =
  'id, title, icon, cover, properties, is_template, position, created_at, updated_at'

/** Databases are pages of kind 'database'; their non-trashed child pages are the rows. */
export class DatabaseRepository {
  constructor(private readonly pages: PageRepository) {}

  private get db(): PageRepository['db'] {
    return this.pages.db
  }

  create(parentId: PageId | null): PageSummary {
    return this.pages.transaction(() => {
      const page = this.pages.create(parentId)
      this.db
        .prepare("UPDATE pages SET kind = 'database', db_schema = ? WHERE id = ?")
        .run(JSON.stringify(defaultSchema()), page.id)
      return this.pages.summary(page.id)
    })
  }

  schemaOf(id: PageId): DatabaseSchema | null {
    const row = this.db
      .prepare("SELECT db_schema FROM pages WHERE id = ? AND kind = 'database'")
      .get(id) as { db_schema: string | null } | undefined
    return row ? parseSchema(row.db_schema) : null
  }

  /** Schema and rows with formulas and rollups computed. */
  get(id: PageId): DatabaseData | null {
    const stored = this.stored(id)
    if (!stored) return null
    const titles = this.titles()
    const rows = computeDatabase(
      id,
      stored,
      (other) => this.stored(other),
      (pid) => titles.get(pid)
    )
    return { id, schema: stored.schema, rows }
  }

  /** Schema and stored rows, without computed values. */
  private stored(id: PageId): DatabaseSource | null {
    const schema = this.schemaOf(id)
    if (!schema) return null
    const records = this.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM pages WHERE parent_id = ? AND trashed_at IS NULL ORDER BY position`
      )
      .all(id) as unknown as RowRecord[]
    return { schema, rows: records.map((r) => toRow(r, schema)) }
  }

  getRow(rowId: PageId): RowData | null {
    const parent = this.db.prepare('SELECT parent_id FROM pages WHERE id = ?').get(rowId) as
      { parent_id: string | null } | undefined
    const schema = parent?.parent_id ? this.schemaOf(parent.parent_id) : null
    if (!parent?.parent_id || !schema) return null
    const data = this.get(parent.parent_id)
    const row = data?.rows.find((r) => r.id === rowId) ?? this.row(rowId, schema)
    return { databaseId: parent.parent_id, schema, row }
  }

  updateSchema(id: PageId, raw: unknown): DatabaseSchema {
    if (!this.schemaOf(id)) throw new Error(`Database not found: ${id}`)
    const schema = parseSchema(raw)
    this.db
      .prepare('UPDATE pages SET db_schema = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(JSON.stringify(schema), this.pages.now(), id)
    return schema
  }

  createRow(databaseId: PageId, init: NewRow = {}): DatabaseRow {
    const schema = this.schemaOf(databaseId)
    if (!schema) throw new Error(`Database not found: ${databaseId}`)
    return this.pages.transaction(() => {
      const page = this.pages.create(databaseId)
      let values: Record<string, PropertyValue> = {}
      let title = init.title ?? ''
      if (init.templateId) {
        const template = this.pages.get(init.templateId)
        if (!template || template.parentId !== databaseId) throw new Error('Template not found')
        this.db
          .prepare(
            `UPDATE pages SET (icon, cover, content, properties) =
               (SELECT icon, cover, content, properties FROM pages WHERE id = ?)
             WHERE id = ?`
          )
          .run(template.id, page.id)
        values = this.row(page.id, schema).properties
        if (!init.title) title = template.title
      }
      values = { ...values, ...normalizeAll(schema, init.properties ?? {}) }
      this.write(page.id, title, values)
      return this.getRow(page.id)!.row
    })
  }

  /** Merges new values into a row; `title` is the row title. Invalid values are cleared. */
  updateRow(rowId: PageId, values: Record<string, unknown>): DatabaseRow {
    const data = this.getRow(rowId)
    if (!data) throw new Error(`Row not found: ${rowId}`)
    const merged: Record<string, PropertyValue> = { ...data.row.properties }
    for (const [key, value] of Object.entries(values)) {
      const prop = data.schema.properties.find((p) => p.id === key)
      if (!prop || prop.type === 'title' || isComputed(prop.type)) continue
      const v = normalizeValue(prop, value)
      if (v === null) delete merged[key]
      else merged[key] = v
    }
    const title = typeof values.title === 'string' ? values.title : data.row.title
    // The row read above carries computed values: only stored ones are written.
    this.write(rowId, title, normalizeAll(data.schema, merged))
    return this.getRow(rowId)!.row
  }

  setTemplate(rowId: PageId, isTemplate: boolean): void {
    if (!this.getRow(rowId)) throw new Error(`Row not found: ${rowId}`)
    this.db
      .prepare(
        'UPDATE pages SET is_template = ?, updated_at = ?, version = version + 1 WHERE id = ?'
      )
      .run(isTemplate ? 1 : 0, this.pages.now(), rowId)
  }

  /** Changes a property's type and converts every row's value in one transaction. */
  changePropertyType(databaseId: PageId, propertyId: string, type: PropertyType): DatabaseSchema {
    return this.pages.transaction(() => {
      const data = this.get(databaseId)
      if (!data) throw new Error(`Database not found: ${databaseId}`)
      const prop = data.schema.properties.find((p) => p.id === propertyId)
      if (!prop || prop.type === 'title' || type === 'title')
        throw new Error('Property cannot change type')
      const titles = this.titles()
      const { property, values } = convertProperty(prop, type, data.rows, (id) => titles.get(id))
      const schema = this.updateSchema(databaseId, {
        ...data.schema,
        properties: data.schema.properties.map((p) => (p.id === propertyId ? property : p))
      })
      for (const row of data.rows) {
        const next = { ...row.properties }
        const v = values.get(row.id) ?? null
        if (v === null) delete next[propertyId]
        else next[propertyId] = v
        this.write(row.id, row.title, normalizeAll(schema, next), false)
      }
      return schema
    })
  }

  private titles(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, title FROM pages').all() as {
      id: string
      title: string
    }[]
    return new Map(rows.map((r) => [r.id, r.title]))
  }

  private row(id: PageId, schema: DatabaseSchema): DatabaseRow {
    const record = this.db.prepare(`SELECT ${ROW_COLUMNS} FROM pages WHERE id = ?`).get(id) as
      RowRecord | undefined
    if (!record) throw new Error(`Row not found: ${id}`)
    return toRow(record, schema)
  }

  private write(
    id: PageId,
    title: string,
    values: Record<string, PropertyValue>,
    touch = true
  ): void {
    this.db
      .prepare(
        `UPDATE pages SET title = ?, properties = ?, version = version + 1${touch ? ', updated_at = ?' : ''} WHERE id = ?`
      )
      .run(
        ...([title, JSON.stringify(values), ...(touch ? [this.pages.now()] : []), id] as (
          string | number
        )[])
      )
    this.pages.reindex(id)
  }
}

function normalizeAll(
  schema: DatabaseSchema,
  values: Record<string, unknown>
): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {}
  for (const prop of schema.properties) {
    const v = normalizeValue(prop, values[prop.id])
    if (v !== null) out[prop.id] = v
  }
  return out
}

const toRow = (r: RowRecord, schema: DatabaseSchema): DatabaseRow => ({
  id: r.id,
  title: r.title,
  icon: r.icon,
  cover: r.cover,
  properties: parseRowProperties(r.properties, schema),
  isTemplate: r.is_template === 1,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})
