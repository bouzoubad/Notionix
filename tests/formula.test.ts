import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { FormulaError, evaluate, parseFormula, type FormulaValue } from '../src/shared/formula'
import { computeDatabase, type DatabaseSource } from '../src/shared/computed'
import { defaultView, type DatabaseRow, type PropertyDef } from '../src/shared/database'
import { migrate } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'
import { DatabaseRepository } from '../src/core/db/databaseRepository'

const run = (src: string, props: Record<string, FormulaValue> = {}): FormulaValue =>
  evaluate(parseFormula(src), {
    now: () => new Date(2026, 9, 14, 10, 30),
    prop: (name) => {
      if (!(name in props)) throw new FormulaError(`Propriété inconnue : « ${name} ».`)
      return props[name]
    }
  })

describe('formula language', () => {
  it('computes arithmetic with precedence, text and logic', () => {
    expect(run('1 + 2 * 3 ^ 2')).toBe(19)
    expect(run('-(2 + 3) * 2')).toBe(-10)
    expect(run('prop("Prix") * 1.2', { Prix: 10 })).toBe(12)
    expect(run('"Total : " + prop("N")', { N: 3 })).toBe('Total : 3')
    expect(run('if(prop("Fait"), "✅", "⏳")', { Fait: false })).toBe('⏳')
    expect(run('prop("A") > 2 and not prop("B")', { A: 3, B: false })).toBe(true)
    expect(run('round(10 / 3, 2)')).toBe(3.33)
    expect(run('max(1, 7, 3) + min(4, 2)')).toBe(9)
  })

  it('handles text, lists and emptiness', () => {
    expect(run('upper(slice("notionix", 0, 6))')).toBe('NOTION')
    expect(run('length(prop("Tags"))', { Tags: ['a', 'b'] })).toBe(2)
    expect(run('contains(prop("Tags"), "b")', { Tags: ['a', 'b'] })).toBe(true)
    expect(run('join(prop("Tags"), " / ")', { Tags: ['a', 'b'] })).toBe('a / b')
    expect(run('empty(prop("Note"))', { Note: '' })).toBe(true)
    expect(run('replace("a-b-c", "-", "+")')).toBe('a+b+c')
  })

  it('works with dates', () => {
    const start = new Date(2026, 0, 31)
    expect(run('formatDate(dateAdd(prop("D"), 1, "months"), "DD/MM/YYYY")', { D: start })).toBe(
      '03/03/2026'
    )
    expect(
      run('dateBetween(prop("Fin"), prop("Début"), "days")', {
        Fin: new Date(2026, 1, 10),
        Début: start
      })
    ).toBe(10)
    expect(run('year(today()) * 100 + month(now())')).toBe(202610)
  })

  it('reports clear errors', () => {
    expect(() => parseFormula('1 +')).toThrow(/incomplète/)
    expect(() => parseFormula('"abc')).toThrow(/guillemet/)
    expect(() => run('prop("X")')).toThrow(/Propriété inconnue/)
    expect(() => run('foo(1)')).toThrow(/Fonction inconnue/)
    expect(() => run('1 / 0')).toThrow(/zéro/)
    expect(() => run('Prix * 2')).toThrow(/prop\("Prix"\)/)
  })
})

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
  updatedAt: 0
})

describe('computeDatabase', () => {
  it('evaluates formulas, including formulas of formulas, and stops on cycles', () => {
    const props: PropertyDef[] = [
      { id: 'title', name: 'Nom', type: 'title' },
      { id: 'q', name: 'Qté', type: 'number' },
      { id: 'p', name: 'Prix', type: 'number' },
      { id: 'ht', name: 'HT', type: 'formula', formula: 'prop("Qté") * prop("Prix")' },
      { id: 'ttc', name: 'TTC', type: 'formula', formula: 'round(prop("HT") * 1.2, 2)' },
      { id: 'c1', name: 'C1', type: 'formula', formula: 'prop("C2")' },
      { id: 'c2', name: 'C2', type: 'formula', formula: 'prop("C1")' },
      { id: 'bad', name: 'Bad', type: 'formula', formula: 'prop("Inconnue")' }
    ]
    const src: DatabaseSource = {
      schema: { properties: props, views: [defaultView()] },
      rows: [row('A', { q: 3, p: 2.5 })]
    }
    const [r] = computeDatabase(
      'db',
      src,
      () => null,
      () => undefined
    )
    expect(r.properties.ht).toBe(7.5)
    expect(r.properties.ttc).toBe(9)
    expect(r.properties.c1).toMatchObject({ error: expect.stringMatching(/circulaire/) })
    expect(r.properties.bad).toMatchObject({ error: expect.stringMatching(/Inconnue/) })
  })

  it('computes rollups over related rows of another database', () => {
    const tasks: DatabaseSource = {
      schema: {
        properties: [
          { id: 'title', name: 'Nom', type: 'title' },
          { id: 'h', name: 'Heures', type: 'number' },
          { id: 'done', name: 'Fait', type: 'checkbox' },
          { id: 'due', name: 'Échéance', type: 'date' },
          { id: 'cost', name: 'Coût', type: 'formula', formula: 'prop("Heures") * 50' }
        ],
        views: [defaultView()]
      },
      rows: [
        row('T1', { h: 2, done: true, due: { start: '2026-10-20' } }),
        row('T2', { h: 6, due: { start: '2026-10-05' } }),
        row('T3', { h: 1, done: true })
      ]
    }
    const [t1, t2, t3] = tasks.rows
    const rollup = (id: string, aggregate: string, target: string | null = null): PropertyDef => ({
      id,
      name: id,
      type: 'rollup',
      rollup: { relationPropertyId: 'rel', targetPropertyId: target, aggregate: aggregate as never }
    })
    const projects: DatabaseSource = {
      schema: {
        properties: [
          { id: 'title', name: 'Nom', type: 'title' },
          { id: 'rel', name: 'Tâches', type: 'relation', relationDatabaseId: 'tasks' },
          rollup('count', 'count'),
          rollup('sum', 'sum', 'h'),
          rollup('avg', 'average', 'h'),
          rollup('pct', 'percent_checked', 'done'),
          rollup('first', 'earliest', 'due'),
          rollup('names', 'show_original', 'title'),
          rollup('cost', 'sum', 'cost'),
          rollup('missing', 'sum', null)
        ],
        views: [defaultView()]
      },
      rows: [row('P', { rel: [t1.id, t2.id, t3.id] }), row('Vide', {})]
    }
    const titles = new Map(tasks.rows.map((r) => [r.id, r.title]))
    const [p, empty] = computeDatabase(
      'projects',
      projects,
      (id) => (id === 'tasks' ? tasks : null),
      (id) => titles.get(id)
    )
    expect(p.properties).toMatchObject({
      count: 3,
      sum: 9,
      avg: 3,
      pct: 66.7,
      first: { start: '2026-10-05' },
      names: ['T1', 'T2', 'T3'],
      cost: 450,
      missing: { error: expect.any(String) }
    })
    expect(empty.properties.count).toBe(0)
    expect(empty.properties.sum).toBe(0)
  })
})

describe('repository with computed properties', () => {
  it('returns computed values but never stores them', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    migrate(db)
    const pages = new PageRepository(db)
    const dbs = new DatabaseRepository(pages)
    const d = dbs.create(null)
    const base = dbs.get(d.id)!.schema
    dbs.updateSchema(d.id, {
      ...base,
      properties: [
        ...base.properties,
        { id: 'q', name: 'Qté', type: 'number' },
        { id: 'f', name: 'Double', type: 'formula', formula: 'prop("Qté") * 2' }
      ]
    })
    const r = dbs.createRow(d.id, { title: 'x', properties: { q: 4, f: 999 as never } })
    expect(r.properties).toEqual({ q: 4, f: 8 })
    const updated = dbs.updateRow(r.id, { q: 5 })
    expect(updated.properties.f).toBe(10)
    const stored = db.prepare('SELECT properties FROM pages WHERE id = ?').get(r.id) as {
      properties: string
    }
    expect(JSON.parse(stored.properties)).toEqual({ q: 5 })
  })
})
