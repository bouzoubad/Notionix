import {
  OPTION_COLORS,
  TITLE_PROPERTY_ID,
  isComputed,
  newId,
  parseCheckbox,
  parseDate,
  parseNumber,
  splitMulti,
  type DatabaseSchema,
  type PropertyDef,
  type PropertyValue
} from '../../shared/database'
import type { Person } from '../../shared/types'
import type { DatabaseRepository } from '../db/databaseRepository'
import { parseCsv } from './csv'
import { inferDatabase } from './notionDatabase'

export interface CsvImportResult {
  rows: number
  /** Columns that had no property of their name, added to the database */
  propertiesAdded: string[]
}

const key = (s: string): string => s.trim().toLowerCase()

/**
 * Adds the rows of a CSV file to an existing database. Columns go to the
 * properties of the same name (the title to the title property, or the first
 * column); other columns become new properties of the type their values
 * suggest. Select options that do not exist yet are created.
 */
export function importCsvRows(
  dbs: Pick<DatabaseRepository, 'get' | 'updateSchema' | 'createRow'>,
  databaseId: string,
  csv: string,
  people: Person[] = []
): CsvImportResult {
  const table = parseCsv(csv.replace(/^\uFEFF/, ''))
  const [header, ...data] = table
  if (!header || header.length === 0) throw new Error('Fichier CSV vide.')
  const db = dbs.get(databaseId)
  if (!db) throw new Error('Base introuvable.')
  const schema: DatabaseSchema = structuredClone(db.schema)
  const inferred = inferDatabase(table)
  const titleProp = schema.properties.find((p) => p.id === TITLE_PROPERTY_ID)!
  const titleIndex = Math.max(
    0,
    header.findIndex((h) => key(h) === key(titleProp.name))
  )

  // Column → property: an existing one of the same name, or a new one.
  const added: string[] = []
  const columns: { index: number; prop: PropertyDef }[] = []
  header.forEach((name, index) => {
    if (index === titleIndex || !name.trim()) return
    const existing = schema.properties.find((p) => key(p.name) === key(name))
    if (existing) {
      if (!isComputed(existing.type) && existing.type !== 'unique_id' && existing.type !== 'files')
        columns.push({ index, prop: existing })
      return
    }
    const guess = inferred?.schema.properties.find((p) => key(p.name) === key(name))
    const prop: PropertyDef = {
      id: newId(),
      name: name.trim(),
      type: guess?.type && guess.type !== 'title' ? guess.type : 'text',
      ...(guess?.options ? { options: [] } : {})
    }
    schema.properties.push(prop)
    added.push(prop.name)
    columns.push({ index, prop })
  })

  // Options named in the file are created on the way.
  const optionOf = (prop: PropertyDef, name: string): string | null => {
    const found = prop.options?.find((o) => key(o.name) === key(name))
    if (found) return found.id
    if (prop.type === 'status') return null
    prop.options = prop.options ?? []
    const option = {
      id: newId(),
      name: name.trim(),
      color: OPTION_COLORS[prop.options.length % OPTION_COLORS.length]
    }
    prop.options.push(option)
    return option.id
  }
  const relationTitles = new Map<string, Map<string, string>>()
  const rowsOf = (dbId: string): Map<string, string> => {
    if (!relationTitles.has(dbId))
      relationTitles.set(
        dbId,
        new Map((dbs.get(dbId)?.rows ?? []).map((r) => [key(r.title), r.id]))
      )
    return relationTitles.get(dbId)!
  }
  const personOf = (text: string): string | null =>
    people.find((p) => key(p.name) === key(text) || key(p.email) === key(text))?.id ?? null

  const valueOf = (prop: PropertyDef, text: string): PropertyValue => {
    if (!text) return null
    switch (prop.type) {
      case 'number':
        return parseNumber(text)
      case 'checkbox':
        return parseCheckbox(text) === true
      case 'date':
        return parseDate(text)
      case 'select':
      case 'status':
        return optionOf(prop, text)
      case 'multi_select': {
        const ids = splitMulti(text)
          .map((n) => optionOf(prop, n))
          .filter((id): id is string => !!id)
        return ids.length ? ids : null
      }
      case 'person': {
        const ids = splitMulti(text)
          .map(personOf)
          .filter((id): id is string => !!id)
        return ids.length ? ids : null
      }
      case 'relation': {
        if (!prop.relationDatabaseId) return null
        const titles = rowsOf(prop.relationDatabaseId)
        const ids = splitMulti(text)
          .map((t) => titles.get(key(t.replace(/\s*\([^)]*\)$/, ''))))
          .filter((id): id is string => !!id)
        return ids.length ? ids : null
      }
      default:
        return text
    }
  }

  const parsed = data
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const values: Record<string, PropertyValue> = {}
      for (const { index, prop } of columns) {
        const v = valueOf(prop, (r[index] ?? '').trim())
        if (v !== null) values[prop.id] = v
      }
      return { title: (r[titleIndex] ?? '').trim(), values }
    })
  dbs.updateSchema(databaseId, schema)
  for (const row of parsed) dbs.createRow(databaseId, { title: row.title, properties: row.values })
  return { rows: parsed.length, propertiesAdded: added }
}
