import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'
import { DatabaseRepository } from '../src/core/db/databaseRepository'
import {
  applyView,
  compareValues,
  convertProperty,
  defaultView,
  mergeSchema,
  groupRows,
  matchesFilter,
  normalizeValue,
  parseDate,
  parseNumber,
  parseSchema,
  type DatabaseRow,
  type DatabaseSchema,
  type PropertyDef
} from '../src/shared/database'

const select: PropertyDef = {
  id: 'status',
  name: 'Statut',
  type: 'select',
  options: [
    { id: 'todo', name: 'À faire', color: 'gray' },
    { id: 'doing', name: 'En cours', color: 'blue' },
    { id: 'done', name: 'Terminé', color: 'green' }
  ]
}
const tags: PropertyDef = {
  id: 'tags',
  name: 'Tags',
  type: 'multi_select',
  options: [
    { id: 'a', name: 'Alpha', color: 'red' },
    { id: 'b', name: 'Beta', color: 'blue' }
  ]
}
const schema: DatabaseSchema = {
  properties: [
    { id: 'title', name: 'Nom', type: 'title' },
    select,
    tags,
    { id: 'points', name: 'Points', type: 'number' },
    { id: 'due', name: 'Échéance', type: 'date' },
    { id: 'ok', name: 'Validé', type: 'checkbox' },
    { id: 'note', name: 'Note', type: 'text' }
  ],
  views: [defaultView()]
}
let n = 0
const row = (
  title: string,
  properties: DatabaseRow['properties'],
  extra: Partial<DatabaseRow> = {}
): DatabaseRow => ({
  id: `r${++n}`,
  title,
  icon: null,
  cover: null,
  properties,
  isTemplate: false,
  position: n,
  createdAt: 0,
  updatedAt: 0,
  createdBy: null,
  updatedBy: null,
  ...extra
})

describe('values', () => {
  it('normalizes values against their property', () => {
    expect(normalizeValue(select, 'doing')).toBe('doing')
    expect(normalizeValue(select, 'unknown')).toBeNull()
    expect(normalizeValue(tags, ['a', 'zzz', 'a'])).toEqual(['a'])
    expect(normalizeValue({ id: 'n', name: 'n', type: 'number' }, Number.NaN)).toBeNull()
    expect(normalizeValue({ id: 'd', name: 'd', type: 'date' }, { start: '2026-02-30' })).toBeNull()
    expect(
      normalizeValue(
        { id: 'd', name: 'd', type: 'date' },
        { start: '2026-10-14', end: '2026-10-01' }
      )
    ).toEqual({
      start: '2026-10-14'
    })
    expect(normalizeValue({ id: 't', name: 'Nom', type: 'title' }, 'x')).toBeNull()
  })

  it('parses numbers and dates written by people and by Notion', () => {
    expect(parseNumber('1 234,5')).toBe(1234.5)
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('1.234,5')).toBe(1234.5)
    expect(parseNumber('12%')).toBe(12)
    expect(parseNumber('abc')).toBeNull()
    expect(parseDate('October 14, 2026')).toEqual({ start: '2026-10-14' })
    expect(parseDate('October 14, 2026 2:05 PM')).toEqual({ start: '2026-10-14T14:05' })
    expect(parseDate('14/10/2026')).toEqual({ start: '2026-10-14' })
    expect(parseDate('14 octobre 2026')).toEqual({ start: '2026-10-14' })
    expect(parseDate('October 1, 2026 → October 3, 2026')).toEqual({
      start: '2026-10-01',
      end: '2026-10-03'
    })
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('demain')).toBeNull()
  })
})

describe('views', () => {
  const rows = [
    row('Écrire la doc', { status: 'doing', points: 3, tags: ['a'], due: { start: '2026-10-20' } }),
    row('Corriger', { status: 'done', points: 1, tags: ['a', 'b'], ok: true }),
    row('Planifier', { status: 'todo', points: 8 }),
    row('Sans statut', {}),
    row('Modèle', { status: 'todo' }, { isTemplate: true })
  ]

  it('filters by type, combines with and/or, and hides templates', () => {
    const view = {
      ...defaultView(),
      filters: [{ id: 'f', propertyId: 'points', operator: 'gte' as const, value: 3 }]
    }
    expect(applyView(rows, schema, view).map((r) => r.title)).toEqual([
      'Écrire la doc',
      'Planifier'
    ])
    const or = {
      ...view,
      filterMode: 'or' as const,
      filters: [
        ...view.filters,
        { id: 'g', propertyId: 'tags', operator: 'contains' as const, value: 'b' }
      ]
    }
    expect(applyView(rows, schema, or)).toHaveLength(3)
    const text = {
      ...defaultView(),
      filters: [{ id: 'h', propertyId: 'title', operator: 'contains' as const, value: 'ecrire' }]
    }
    expect(applyView(rows, schema, text).map((r) => r.title)).toEqual(['Écrire la doc']) // accents ignored
    const incomplete = {
      ...defaultView(),
      filters: [{ id: 'i', propertyId: 'status', operator: 'equals' as const, value: null }]
    }
    expect(applyView(rows, schema, incomplete)).toHaveLength(4)
  })

  it('sorts by option order, numbers and dates, empty values last', () => {
    const byStatus = {
      ...defaultView(),
      sorts: [{ propertyId: 'status', direction: 'asc' as const }]
    }
    expect(applyView(rows, schema, byStatus).map((r) => r.title)).toEqual([
      'Planifier',
      'Écrire la doc',
      'Corriger',
      'Sans statut'
    ])
    const byPoints = {
      ...defaultView(),
      sorts: [{ propertyId: 'points', direction: 'desc' as const }]
    }
    expect(applyView(rows, schema, byPoints).map((r) => r.title)).toEqual([
      'Planifier',
      'Écrire la doc',
      'Corriger',
      'Sans statut'
    ])
    expect(
      compareValues(schema.properties[4], { start: '2026-01-01' }, { start: '2025-12-31' })
    ).toBeGreaterThan(0)
  })

  it('matches date filters on ranges and checkbox filters', () => {
    const due = schema.properties[4]
    const range = { start: '2026-10-01', end: '2026-10-05' }
    expect(
      matchesFilter(due, range, {
        id: 'x',
        propertyId: 'due',
        operator: 'equals',
        value: '2026-10-03'
      })
    ).toBe(true)
    expect(
      matchesFilter(due, range, {
        id: 'x',
        propertyId: 'due',
        operator: 'before',
        value: '2026-10-02'
      })
    ).toBe(true)
    expect(
      matchesFilter(due, null, {
        id: 'x',
        propertyId: 'due',
        operator: 'after',
        value: '2026-10-02'
      })
    ).toBe(false)
    expect(
      matchesFilter(schema.properties[5], true, {
        id: 'x',
        propertyId: 'ok',
        operator: 'is_checked'
      })
    ).toBe(true)
  })

  it('groups rows by select option, with a "no value" column first', () => {
    const groups = groupRows(
      rows.filter((r) => !r.isTemplate),
      select
    )
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.title)])).toEqual([
      [null, ['Sans statut']],
      ['todo', ['Planifier']],
      ['doing', ['Écrire la doc']],
      ['done', ['Corriger']]
    ])
  })
})

describe('schema and conversions', () => {
  it('repairs invalid schemas', () => {
    const parsed = parseSchema({
      properties: [
        { id: 'x', name: 'X', type: 'nope' },
        { id: 'p', name: 'P', type: 'number' },
        { id: 'p', name: 'Dup', type: 'text' }
      ],
      views: [
        {
          id: 'v',
          type: 'board',
          groupBy: 'p',
          hidden: ['title', 'p', 'ghost'],
          sorts: [{ propertyId: 'ghost' }]
        }
      ]
    })
    expect(parsed.properties.map((p) => p.id)).toEqual(['title', 'p'])
    expect(parsed.views[0]).toMatchObject({ groupBy: null, hidden: ['p'], sorts: [] })
    expect(parseSchema('not json').views).toHaveLength(1)
    const mismatched = parseSchema({
      properties: [{ id: 'p', name: 'P', type: 'text' }],
      views: [
        {
          id: 'v',
          type: 'table',
          filters: [
            { id: 'f', propertyId: 'p', operator: 'gte', value: 3 },
            { id: 'g', propertyId: 'p', operator: 'contains', value: 'x' }
          ]
        }
      ]
    })
    expect(mismatched.views[0].filters.map((f) => f.id)).toEqual(['g'])
  })

  it('converts text to select (creating options), select to text and text to number', () => {
    const note: PropertyDef = { id: 'note', name: 'Note', type: 'text' }
    const rows = [
      row('a', { note: 'Haute' }),
      row('b', { note: 'Basse' }),
      row('c', { note: 'Haute' }),
      row('d', {})
    ]
    const toSelect = convertProperty(note, 'select', rows)
    expect(toSelect.property.options?.map((o) => o.name)).toEqual(['Haute', 'Basse'])
    const ids = rows.map((r) => toSelect.values.get(r.id))
    expect(ids[0]).toBe(ids[2])
    expect(ids[3]).toBeNull()
    const back = convertProperty(
      toSelect.property,
      'text',
      rows.map((r) => ({ ...r, properties: { note: toSelect.values.get(r.id) ?? null } }))
    )
    expect(back.values.get(rows[1].id)).toBe('Basse')
    const nums = convertProperty(note, 'number', [
      row('n', { note: '1 200,5' }),
      row('m', { note: 'x' })
    ])
    expect([...nums.values.values()]).toEqual([1200.5, null])
  })
})

describe('DatabaseRepository', () => {
  let pages: PageRepository
  let dbs: DatabaseRepository
  beforeEach(() => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    migrate(db)
    let clock = 1000
    pages = new PageRepository(db, () => ++clock)
    dbs = new DatabaseRepository(pages)
  })

  const withStatus = (id: string): DatabaseSchema => {
    const current = dbs.get(id)!.schema
    return dbs.updateSchema(id, {
      ...current,
      properties: [...current.properties, select, { id: 'points', name: 'Points', type: 'number' }]
    })
  }

  it('creates a database with a default schema and rows with validated values', () => {
    const database = dbs.create(null)
    expect(database.kind).toBe('database')
    withStatus(database.id)
    const r = dbs.createRow(database.id, {
      title: 'Tâche',
      properties: { status: 'doing', points: 'oops' as never }
    })
    expect(r.properties).toEqual({ status: 'doing' })
    const updated = dbs.updateRow(r.id, { points: 5, status: null, title: 'Tâche 1' })
    expect(updated).toMatchObject({ title: 'Tâche 1', properties: { points: 5 } })
    expect(dbs.get(database.id)!.rows.map((x) => x.title)).toEqual(['Tâche 1'])
    expect(dbs.getRow(r.id)?.databaseId).toBe(database.id)
    expect(dbs.getRow(database.id)).toBeNull()
  })

  it('indexes property values for search', () => {
    const database = dbs.create(null)
    withStatus(database.id)
    const r = dbs.createRow(database.id, { title: 'Ligne', properties: { status: 'done' } })
    expect(pages.search('termine').map((h) => h.id)).toEqual([r.id])
  })

  it('creates rows from a template and hides templates from views', () => {
    const database = dbs.create(null)
    withStatus(database.id)
    const template = dbs.createRow(database.id, {
      title: 'Réunion',
      properties: { status: 'todo' }
    })
    pages.update(template.id, {
      content:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Ordre du jour"}]}]}'
    })
    dbs.setTemplate(template.id, true)
    const fromTemplate = dbs.createRow(database.id, {
      templateId: template.id,
      properties: { points: 2 }
    })
    expect(fromTemplate).toMatchObject({
      title: 'Réunion',
      isTemplate: false,
      properties: { status: 'todo', points: 2 }
    })
    expect(pages.get(fromTemplate.id)!.content).toContain('Ordre du jour')
    const data = dbs.get(database.id)!
    expect(applyView(data.rows, data.schema, data.schema.views[0]).map((x) => x.id)).toEqual([
      fromTemplate.id
    ])
  })

  it('converts a property type for every row atomically', () => {
    const database = dbs.create(null)
    withStatus(database.id)
    const a = dbs.createRow(database.id, { title: 'a', properties: { status: 'done' } })
    const schema = dbs.changePropertyType(database.id, 'status', 'text')
    expect(schema.properties.find((p) => p.id === 'status')!.type).toBe('text')
    expect(dbs.getRow(a.id)!.row.properties.status).toBe('Terminé')
    expect(() => dbs.changePropertyType(database.id, 'title', 'number')).toThrow()
  })

  it('keeps pages out of databases and duplicates databases with their rows', () => {
    const database = dbs.create(null)
    withStatus(database.id)
    dbs.createRow(database.id, { title: 'r', properties: { status: 'todo' } })
    const loose = pages.create(null)
    expect(() => pages.move(loose.id, database.id, 0)).toThrow(/database/)
    const copy = pages.duplicate(database.id)
    const copied = dbs.get(copy.id)!
    expect(copied.schema.properties.map((p) => p.id)).toContain('status')
    expect(copied.rows.map((r) => [r.title, r.properties.status])).toEqual([['r', 'todo']])
  })
})

describe('schema merge', () => {
  it('keeps the changes of both people', () => {
    const base = {
      properties: [
        { id: 'title', name: 'Nom', type: 'title' as const },
        { id: 'a', name: 'A', type: 'text' as const },
        { id: 'b', name: 'B', type: 'text' as const }
      ],
      views: [defaultView()]
    }
    // Someone else renamed B and added C meanwhile.
    const current = {
      ...base,
      properties: [
        base.properties[0],
        base.properties[1],
        { ...base.properties[2], name: 'B renommée' },
        { id: 'c', name: 'C', type: 'number' as const }
      ]
    }
    // This person renamed A and added D.
    const next = {
      ...base,
      properties: [
        base.properties[0],
        { ...base.properties[1], name: 'A renommée' },
        base.properties[2],
        { id: 'd', name: 'D', type: 'checkbox' as const }
      ]
    }
    const merged = mergeSchema(base, next, current)
    expect(merged.properties.map((p) => p.name)).toEqual([
      'Nom',
      'A renommée',
      'B renommée',
      'D',
      'C'
    ])
    // Deleting a property others did not touch removes it.
    const removed = mergeSchema(base, { ...base, properties: base.properties.slice(0, 2) }, current)
    expect(removed.properties.map((p) => p.id)).toEqual(['title', 'a', 'c'])
  })
})
