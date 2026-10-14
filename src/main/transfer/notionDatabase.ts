import {
  OPTION_COLORS,
  TITLE_PROPERTY_ID,
  defaultView,
  newId,
  parseCheckbox,
  parseDate,
  parseNumber,
  splitMulti,
  type DatabaseSchema,
  type PropertyDef,
  type PropertyType,
  type PropertyValue
} from '../../shared/database'

export interface InferredDatabase {
  schema: DatabaseSchema
  titleColumn: string
  /** One entry per CSV data row: its title and its typed values */
  rows: { title: string; values: Record<string, PropertyValue> }[]
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_LIKE = /^https?:\/\/\S+$/i
const MAX_OPTIONS = 40

/**
 * Builds a database from a Notion CSV export: the first column is the title;
 * the type of every other column is inferred from all of its non-empty values.
 */
export function inferDatabase(table: string[][]): InferredDatabase | null {
  const [header, ...data] = table
  if (!header || header.length === 0) return null
  const width = header.length
  const titleColumn = header[0].trim() || 'Nom'
  const properties: PropertyDef[] = [{ id: TITLE_PROPERTY_ID, name: titleColumn, type: 'title' }]
  const columns: { prop: PropertyDef; index: number }[] = []
  const usedNames = new Set([titleColumn])
  for (let index = 1; index < width; index += 1) {
    const values = data.map((r) => (r[index] ?? '').trim()).filter(Boolean)
    let name = header[index].trim() || `Colonne ${index + 1}`
    for (let n = 2; usedNames.has(name); n += 1)
      name = `${header[index].trim() || 'Colonne'} (${n})`
    usedNames.add(name)
    const prop: PropertyDef = { id: newId(), name, type: inferType(values, data.length) }
    if (prop.type === 'select' || prop.type === 'multi_select') {
      const names = prop.type === 'select' ? values : values.flatMap(splitMulti)
      prop.options = [...new Set(names)].map((n, i) => ({
        id: newId(),
        name: n,
        color: OPTION_COLORS[i % OPTION_COLORS.length]
      }))
    }
    properties.push(prop)
    columns.push({ prop, index })
  }
  const rows = data.map((r) => {
    const values: Record<string, PropertyValue> = {}
    for (const { prop, index } of columns) {
      const v = parseCell(prop, (r[index] ?? '').trim())
      if (v !== null) values[prop.id] = v
    }
    return { title: (r[0] ?? '').trim(), values }
  })
  const views = [defaultView('table')]
  const firstSelect = properties.find((p) => p.type === 'select')
  if (firstSelect) views.push({ ...defaultView('board'), groupBy: firstSelect.id })
  return { schema: { properties, views }, titleColumn, rows }
}

function inferType(values: string[], rowCount: number): PropertyType {
  if (values.length === 0) return 'text'
  const all = (test: (v: string) => boolean): boolean => values.every(test)
  if (all((v) => /^(yes|no|oui|non|true|false)$/i.test(v))) return 'checkbox'
  if (all((v) => parseNumber(v) !== null)) return 'number'
  if (all((v) => parseDate(v) !== null)) return 'date'
  if (all((v) => URL_LIKE.test(v))) return 'url'
  if (all((v) => EMAIL.test(v))) return 'email'
  const distinct = new Set(values)
  const tokens = values.flatMap(splitMulti)
  const distinctTokens = new Set(tokens)
  // Repeated short labels make a select; comma lists of repeated labels a multi-select.
  const isLabel = (v: string): boolean => v.length <= 60 && !/[.!?]\s/.test(v)
  if (
    values.some((v) => v.includes(',')) &&
    tokens.every(isLabel) &&
    distinctTokens.size <= MAX_OPTIONS &&
    distinctTokens.size < tokens.length
  ) {
    return 'multi_select'
  }
  if (
    !values.some((v) => v.includes(',')) &&
    values.every(isLabel) &&
    distinct.size <= MAX_OPTIONS &&
    (distinct.size < values.length || rowCount <= 3)
  ) {
    return 'select'
  }
  return 'text'
}

function parseCell(prop: PropertyDef, text: string): PropertyValue {
  if (!text) return null
  switch (prop.type) {
    case 'checkbox':
      return parseCheckbox(text) === true
    case 'number':
      return parseNumber(text)
    case 'date':
      return parseDate(text)
    case 'select':
      return prop.options?.find((o) => o.name === text)?.id ?? null
    case 'multi_select': {
      const ids = splitMulti(text)
        .map((n) => prop.options?.find((o) => o.name === n)?.id)
        .filter((id): id is string => !!id)
      return ids.length ? ids : null
    }
    default:
      return text
  }
}
