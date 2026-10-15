import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'
import { DatabaseRepository } from '../src/core/db/databaseRepository'
import { nextOccurrence, parseRule, type RecurrenceRule } from '../src/shared/recurrence'

// Times in UTC+2 (Paris summer time), whatever the machine running the tests.
const at = (iso: string): number => Date.parse(`${iso}+02:00`)
const iso = (ms: number): string =>
  new Date(ms + 2 * 36e5).toISOString().slice(0, 16).replace('T', ' ')
const rule = (r: Partial<RecurrenceRule>): RecurrenceRule =>
  parseRule({ every: 'day', interval: 1, time: '08:00', utcOffset: 120, ...r })

describe('nextOccurrence', () => {
  it('finds the next day, weekday, month or year at the local time', () => {
    const anchor = at('2026-10-15T08:00')
    expect(iso(nextOccurrence(rule({}), at('2026-10-15T09:00'), anchor)!)).toBe('2026-10-16 08:00')
    expect(iso(nextOccurrence(rule({}), at('2026-10-15T07:00'), anchor)!)).toBe('2026-10-15 08:00')
    expect(iso(nextOccurrence(rule({ interval: 3 }), at('2026-10-16T09:00'), anchor)!)).toBe(
      '2026-10-18 08:00'
    )
    // Mondays and Thursdays, every other week from the week of the 15th (a Thursday).
    const weekly = rule({ every: 'week', interval: 2, weekdays: [1, 4] })
    expect(iso(nextOccurrence(weekly, at('2026-10-15T09:00'), anchor)!)).toBe('2026-10-26 08:00')
    expect(iso(nextOccurrence(weekly, at('2026-10-26T09:00'), anchor)!)).toBe('2026-10-29 08:00')
    // The 31st becomes the last day of shorter months.
    const monthly = rule({ every: 'month' })
    const end = at('2026-01-31T08:00')
    expect(iso(nextOccurrence(monthly, end, end)!)).toBe('2026-02-28 08:00')
    expect(iso(nextOccurrence(rule({ every: 'year' }), anchor, anchor)!)).toBe('2027-10-15 08:00')
  })

  it('refuses invalid rules', () => {
    expect(() => parseRule({ every: 'week', interval: 1, time: '08:00', weekdays: [] })).toThrow(
      /jour/
    )
    expect(() => parseRule({ every: 'day', interval: 0, time: '08:00' })).toThrow(/Intervalle/)
    expect(() => parseRule({ every: 'day', interval: 1, time: '25:00' })).toThrow(/Heure/)
    expect(() => parseRule({ every: 'hour', interval: 1, time: '08:00' })).toThrow()
  })
})

describe('recurring templates and locked databases', () => {
  let clock = at('2026-10-15T07:00')
  let pages: PageRepository
  let dbs: DatabaseRepository
  beforeEach(() => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    migrate(db)
    clock = at('2026-10-15T07:00')
    pages = new PageRepository(db, () => clock)
    pages.actor = 'alice'
    dbs = new DatabaseRepository(pages)
  })

  it('creates a row from the template when due, once, with the day of the occurrence', () => {
    const db = dbs.create(null)
    const schema = dbs.updateSchema(db.id, {
      ...dbs.schemaOf(db.id)!,
      properties: [...dbs.schemaOf(db.id)!.properties, { id: 'd', name: 'Jour', type: 'date' }]
    })
    const template = dbs.createRow(db.id, { title: 'Point hebdo' })
    dbs.setTemplate(template.id, true)
    expect(() => dbs.setRecurrence(db.id, 'other', rule({}))).toThrow(/Modèle/)
    const r = dbs.setRecurrence(db.id, template.id, rule({ dateProperty: 'd' }))!
    expect(iso(r.nextAt)).toBe('2026-10-15 08:00')
    expect(dbs.runDueRecurrences()).toEqual([])
    // Two days later (the app was closed): one row, then the next day.
    clock = at('2026-10-17T09:00')
    expect(dbs.runDueRecurrences()).toEqual([db.id])
    expect(dbs.runDueRecurrences()).toEqual([])
    const rows = dbs.get(db.id)!.rows.filter((row) => !row.isTemplate)
    expect(rows.map((row) => [row.title, row.properties.d])).toEqual([
      ['Point hebdo', { start: '2026-10-17' }]
    ])
    expect(iso(dbs.recurrences(db.id)[0].nextAt)).toBe('2026-10-18 08:00')
    expect(schema.properties.some((p) => p.id === 'd')).toBe(true)
    dbs.setRecurrence(db.id, template.id, null)
    expect(dbs.recurrences(db.id)).toEqual([])
  })

  it('keeps a locked database as it is, except new options and unlocking', () => {
    const db = dbs.create(null)
    const base = dbs.updateSchema(db.id, {
      ...dbs.schemaOf(db.id)!,
      properties: [
        ...dbs.schemaOf(db.id)!.properties,
        {
          id: 's',
          name: 'Statut',
          type: 'select',
          options: [{ id: 'a', name: 'A', color: 'blue' }]
        }
      ]
    })
    const locked = dbs.updateSchema(db.id, { ...base, locked: true })
    expect(locked.locked).toBe(true)
    expect(() =>
      dbs.updateSchema(db.id, { ...locked, properties: locked.properties.slice(0, 1) })
    ).toThrow(/verrouillée/)
    expect(() =>
      dbs.updateSchema(db.id, { ...locked, views: [{ ...locked.views[0], name: 'Autre' }] })
    ).toThrow(/verrouillée/)
    const withOption = dbs.updateSchema(db.id, {
      ...locked,
      properties: locked.properties.map((p) =>
        p.id === 's' ? { ...p, options: [...p.options!, { id: 'b', name: 'B', color: 'red' }] } : p
      )
    })
    expect(withOption.properties.find((p) => p.id === 's')!.options).toHaveLength(2)
    expect(dbs.updateSchema(db.id, { ...withOption, locked: false }).locked).toBeUndefined()
  })
})
