import type { DatabaseData, NewRow, PageId, PageSummary, RowData } from '../../shared/types'
import {
  convertProperty,
  isComputed,
  defaultSchema,
  mergeSchema,
  newId,
  normalizeValue,
  parseRowProperties,
  parseSchema,
  type PropertyDef,
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
  created_by: string | null
  updated_by: string | null
}

const ROW_COLUMNS =
  'id, title, icon, cover, properties, is_template, position, created_at, updated_at, created_by, updated_by'

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

  /**
   * Saves a schema. With `base` (the schema the change started from), the
   * change is merged into the stored schema, keeping what others changed
   * meanwhile. New unique-id properties number the existing rows.
   */
  updateSchema(id: PageId, raw: unknown, base?: unknown): DatabaseSchema {
    const current = this.schemaOf(id)
    if (!current) throw new Error(`Database not found: ${id}`)
    const next = parseSchema(raw)
    const schema =
      base === undefined ? next : parseSchema(mergeSchema(parseSchema(base), next, current))
    return this.pages.transaction(() => {
      this.db
        .prepare(
          'UPDATE pages SET db_schema = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?'
        )
        .run(JSON.stringify(schema), this.pages.now(), this.pages.actor, id)
      for (const prop of schema.properties)
        if (prop.type === 'unique_id' && !current.properties.some((p) => p.id === prop.id))
          this.numberRows(id, schema, prop.id)
      return schema
    })
  }

  /** Gives every row without one the next number of a unique-id property. */
  private numberRows(databaseId: PageId, schema: DatabaseSchema, propertyId: string): void {
    const rows = this.stored(databaseId)?.rows ?? []
    let next = Math.max(0, ...rows.map((r) => Number(r.properties[propertyId] ?? 0))) + 1
    for (const row of rows) {
      if (typeof row.properties[propertyId] === 'number') continue
      this.write(row.id, row.title, { ...row.properties, [propertyId]: next++ }, false)
    }
    void schema
  }

  /** Next number of a unique-id property, for a new row. */
  private nextNumber(databaseId: PageId, propertyId: string): number {
    const rows = this.stored(databaseId)?.rows ?? []
    return Math.max(0, ...rows.map((r) => Number(r.properties[propertyId] ?? 0))) + 1
  }

  /**
   * Makes a relation two-way: the linked database gets a relation back,
   * filled from the current values, and both stay in step from then on.
   */
  linkRelation(databaseId: PageId, propertyId: string, name?: string): DatabaseSchema {
    return this.pages.transaction(() => {
      const schema = this.schemaOf(databaseId)
      const prop = schema?.properties.find((p) => p.id === propertyId && p.type === 'relation')
      if (!schema || !prop?.relationDatabaseId) throw new Error('Relation introuvable.')
      if (prop.syncedPropertyId) return schema
      const targetId = prop.relationDatabaseId
      const reverseId = newId()
      const self = targetId === databaseId
      const title = this.pages.summary(databaseId).title || 'Relation'
      const reverse = {
        id: reverseId,
        name: name ?? (self ? `${prop.name} (lié)` : title),
        type: 'relation' as const,
        relationDatabaseId: databaseId,
        syncedPropertyId: propertyId
      }
      const updated = {
        ...schema,
        properties: [
          ...schema.properties.map((p) =>
            p.id === propertyId ? { ...p, syncedPropertyId: reverseId } : p
          ),
          ...(self ? [reverse] : [])
        ]
      }
      this.updateSchema(databaseId, updated)
      if (!self) {
        const target = this.schemaOf(targetId)
        if (!target) throw new Error('Base liée introuvable.')
        this.updateSchema(targetId, { ...target, properties: [...target.properties, reverse] })
      }
      // The reverse values come from the existing links.
      const rows = this.stored(databaseId)?.rows ?? []
      const back = new Map<string, string[]>()
      for (const row of rows)
        for (const linked of (row.properties[propertyId] as string[] | undefined) ?? [])
          back.set(linked, [...(back.get(linked) ?? []), row.id])
      for (const [linked, ids] of back) this.setRaw(linked, reverseId, ids)
      return this.schemaOf(databaseId)!
    })
  }

  /** Sub-items (parent / sub-items) or dependencies (blocked by / blocking): two linked self-relations. */
  enableNesting(databaseId: PageId, kind: 'subItems' | 'dependencies'): DatabaseSchema {
    return this.pages.transaction(() => {
      const schema = this.schemaOf(databaseId)
      if (!schema) throw new Error(`Database not found: ${databaseId}`)
      if (schema[kind]) return schema
      const [first, second] =
        kind === 'subItems' ? ['Élément parent', 'Sous-éléments'] : ['Bloqué par', 'Bloque']
      const a = newId()
      const b = newId()
      const props = [
        {
          id: a,
          name: first,
          type: 'relation' as const,
          relationDatabaseId: databaseId,
          syncedPropertyId: b
        },
        {
          id: b,
          name: second,
          type: 'relation' as const,
          relationDatabaseId: databaseId,
          syncedPropertyId: a
        }
      ]
      return this.updateSchema(databaseId, {
        ...schema,
        properties: [...schema.properties, ...props],
        [kind]:
          kind === 'subItems'
            ? { parentPropertyId: a, childrenPropertyId: b }
            : { blockedByPropertyId: a, blockingPropertyId: b }
      })
    })
  }

  /** Writes one stored value of a row, without touching the rest (synced relations). */
  private setRaw(rowId: PageId, propertyId: string, value: string[] | null): void {
    const record = this.db
      .prepare('SELECT title, properties FROM pages WHERE id = ?')
      .get(rowId) as { title: string; properties: string | null } | undefined
    if (!record) return
    let props: Record<string, unknown> = {}
    try {
      props = JSON.parse(record.properties ?? '{}') ?? {}
    } catch {
      props = {}
    }
    if (value && value.length) props[propertyId] = value
    else delete props[propertyId]
    this.db
      .prepare('UPDATE pages SET properties = ?, version = version + 1 WHERE id = ?')
      .run(JSON.stringify(props), rowId)
  }

  /**
   * Keeps two-way relations in step after `rowId`'s value of `prop` went from
   * `before` to `after`: linked rows gain or lose this row in their property.
   */
  private syncRelation(prop: PropertyDef, rowId: PageId, before: string[], after: string[]): void {
    if (prop.type !== 'relation' || !prop.syncedPropertyId || !prop.relationDatabaseId) return
    const target = this.schemaOf(prop.relationDatabaseId)
    const reverse = target?.properties.find((p) => p.id === prop.syncedPropertyId)
    if (!target || !reverse) return
    const single = target.subItems?.parentPropertyId === reverse.id
    const valueOf = (id: string): string[] => {
      const row = this.db.prepare('SELECT properties FROM pages WHERE id = ?').get(id) as
        { properties: string | null } | undefined
      const v = parseRowProperties(row?.properties ?? null, target)[reverse.id]
      return Array.isArray(v) ? v : []
    }
    for (const id of after.filter((x) => !before.includes(x))) {
      // A sub-item has one parent: it leaves its previous one.
      if (single)
        for (const old of valueOf(id))
          if (old !== rowId)
            this.setRaw(
              old,
              prop.id,
              valueOf(old).filter((x) => x !== id)
            )
      this.setRaw(id, reverse.id, single ? [rowId] : [...new Set([...valueOf(id), rowId])])
    }
    for (const id of before.filter((x) => !after.includes(x)))
      this.setRaw(
        id,
        reverse.id,
        valueOf(id).filter((x) => x !== rowId)
      )
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
      for (const prop of schema.properties)
        if (prop.type === 'unique_id') values[prop.id] = this.nextNumber(databaseId, prop.id)
      this.write(page.id, title, values)
      for (const prop of schema.properties) {
        const v = values[prop.id]
        if (Array.isArray(v)) this.syncRelation(prop, page.id, [], v)
      }
      return this.getRow(page.id)!.row
    })
  }

  /** Merges new values into a row; `title` is the row title. Invalid values are cleared. */
  updateRow(rowId: PageId, values: Record<string, unknown>): DatabaseRow {
    const data = this.getRow(rowId)
    if (!data) throw new Error(`Row not found: ${rowId}`)
    return this.pages.transaction(() => {
      const merged: Record<string, PropertyValue> = { ...data.row.properties }
      const changed: { prop: PropertyDef; before: string[]; after: string[] }[] = []
      for (const [key, value] of Object.entries(values)) {
        const prop = data.schema.properties.find((p) => p.id === key)
        if (!prop || prop.type === 'title' || isComputed(prop.type) || prop.type === 'unique_id')
          continue
        let v = normalizeValue(prop, value)
        // A sub-item has a single parent: the last one chosen.
        if (data.schema.subItems?.parentPropertyId === prop.id && Array.isArray(v))
          v = v.filter((x) => x !== rowId).slice(-1)
        if (prop.type === 'relation') {
          const before = Array.isArray(merged[key]) ? (merged[key] as string[]) : []
          changed.push({ prop, before, after: Array.isArray(v) ? v : [] })
        }
        if (v === null || (Array.isArray(v) && v.length === 0)) delete merged[key]
        else merged[key] = v
      }
      const title = typeof values.title === 'string' ? values.title : data.row.title
      // The row read above carries computed values: only stored ones are written.
      this.write(rowId, title, normalizeAll(data.schema, merged))
      for (const c of changed) this.syncRelation(c.prop, rowId, c.before, c.after)
      return this.getRow(rowId)!.row
    })
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
      if (type === 'unique_id') this.numberRows(databaseId, schema, propertyId)
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
        `UPDATE pages SET title = ?, properties = ?, version = version + 1${touch ? ', updated_at = ?, updated_by = ?' : ''} WHERE id = ?`
      )
      .run(
        ...([
          title,
          JSON.stringify(values),
          ...(touch ? [this.pages.now(), this.pages.actor] : []),
          id
        ] as (string | number | null)[])
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
  updatedAt: r.updated_at,
  createdBy: r.created_by,
  updatedBy: r.updated_by
})
