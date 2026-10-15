import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  applyView,
  calculate,
  defaultView,
  groupRows,
  relativeRange,
  type DatabaseRow,
  type DatabaseSchema,
  type PropertyDef
} from '../src/shared/database'
import { migrate } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'
import { DatabaseRepository } from '../src/core/db/databaseRepository'
import { importCsvRows } from '../src/core/transfer/csvImport'

let n = 0
const row = (title: string, properties: DatabaseRow['properties']): DatabaseRow => ({
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
  updatedBy: null
})
const price: PropertyDef = { id: 'p', name: 'Prix', type: 'number' }
const done: PropertyDef = { id: 'd', name: 'Fait', type: 'checkbox' }
const when: PropertyDef = { id: 'w', name: 'Quand', type: 'date' }
const tags: PropertyDef = {
  id: 't',
  name: 'Tags',
  type: 'multi_select',
  options: [
    { id: 'a', name: 'A', color: 'red' },
    { id: 'b', name: 'B', color: 'blue' }
  ]
}

describe('column calculations', () => {
  const rows = [
    row('x', { p: 10, d: true, w: { start: '2026-01-05' } }),
    row('y', { p: 30 }),
    row('z', { w: { start: '2026-03-01' } })
  ]
  it('counts, sums and spans', () => {
    expect(calculate(rows, price, 'sum')).toBe('40')
    expect(calculate(rows, price, 'average')).toBe('20')
    expect(calculate(rows, price, 'count_empty')).toBe('1')
    expect(calculate(rows, price, 'percent_not_empty')).toBe('67 %')
    expect(calculate(rows, done, 'percent_checked')).toBe('33 %')
    expect(calculate(rows, when, 'earliest')).toBe('2026-01-05')
    expect(calculate(rows, when, 'range')).toBe('55 j')
  })
})

describe('filters and groups', () => {
  it('reads relative dates as ranges of days', () => {
    const now = new Date(2026, 9, 15) // Thursday 15 October 2026
    expect(relativeRange('@this_week', now)).toEqual(['2026-10-12', '2026-10-18'])
    expect(relativeRange('@last_month', now)).toEqual(['2026-09-01', '2026-09-30'])
    expect(relativeRange('@past_7', now)).toEqual(['2026-10-08', '2026-10-15'])
    expect(relativeRange('inconnu', now)).toBeNull()
  })

  it('combines a filter group with the view filters', () => {
    const schema: DatabaseSchema = {
      properties: [{ id: 'title', name: 'Nom', type: 'title' }, price, done],
      views: [defaultView()]
    }
    const rows = [
      row('cher fait', { p: 100, d: true }),
      row('cher', { p: 100 }),
      row('bon marché fait', { p: 5, d: true })
    ]
    const view = {
      ...schema.views[0],
      filters: [{ id: 'f1', propertyId: 'd', operator: 'is_checked' as const }],
      filterGroups: [
        {
          id: 'g',
          mode: 'or' as const,
          filters: [
            { id: 'f2', propertyId: 'p', operator: 'gt' as const, value: 50 },
            { id: 'f3', propertyId: 'title', operator: 'contains' as const, value: 'marché' }
          ]
        }
      ]
    }
    expect(applyView(rows, schema, view).map((r) => r.title)).toEqual([
      'cher fait',
      'bon marché fait'
    ])
  })

  it('groups by multi-select (a row in each of its options) and by month', () => {
    const rows = [row('ab', { t: ['a', 'b'] }), row('b', { t: ['b'] }), row('none', {})]
    const groups = groupRows(rows, tags)
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.title)])).toEqual([
      ['Sans Tags', ['none']],
      ['A', ['ab']],
      ['B', ['ab', 'b']]
    ])
    const dated = [
      row('mars', { w: { start: '2026-03-10' } }),
      row('janvier', { w: { start: '2026-01-02' } })
    ]
    expect(groupRows(dated, when).map((g) => g.key)).toEqual(['2026-01', '2026-03', null])
  })
})

describe('CSV import into a database', () => {
  it('fills existing properties by name and adds the others', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const pages = new PageRepository(db)
    const dbs = new DatabaseRepository(pages)
    const base = dbs.create(null)
    const schema = dbs.schemaOf(base.id)!
    dbs.updateSchema(base.id, {
      ...schema,
      properties: [
        ...schema.properties,
        {
          id: 's',
          name: 'Statut',
          type: 'select',
          options: [{ id: 'o1', name: 'Ouvert', color: 'blue' }]
        },
        { id: 'who', name: 'Responsable', type: 'person' }
      ]
    })
    const csv = 'Nom,Statut,Responsable,Montant\nDevis,Ouvert,Marie,"1 200,50"\nFacture,Fermé,,30\n'
    const result = importCsvRows(dbs, base.id, csv, [{ id: 'u1', name: 'Marie', email: 'm@x.fr' }])
    expect(result).toEqual({ rows: 2, propertiesAdded: ['Montant'] })
    const data = dbs.get(base.id)!
    const montant = data.schema.properties.find((p) => p.name === 'Montant')!
    expect(montant.type).toBe('number')
    const statut = data.schema.properties.find((p) => p.id === 's')!
    expect(statut.options!.map((o) => o.name)).toEqual(['Ouvert', 'Fermé'])
    const devis = data.rows.find((r) => r.title === 'Devis')!
    expect(devis.properties).toMatchObject({ s: 'o1', who: ['u1'], [montant.id]: 1200.5 })
  })
})
