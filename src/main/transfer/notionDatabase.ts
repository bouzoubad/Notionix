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

export interface RelationTarget {
  /** page id of the linked row */
  id: string
  /** page id of the database holding that row */
  database: string
}

export interface InferOptions {
  /**
   * Resolves one linked row of a relation cell: Notion writes "Title (link)"
   * (link to the row's page) or just the title. Null when it is not a row.
   */
  resolveRelation?: (title: string, link: string | null) => RelationTarget | null
}

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
export function inferDatabase(
  table: string[][],
  options: InferOptions = {}
): InferredDatabase | null {
  const [header, ...data] = table
  if (!header || header.length === 0) return null
  const width = header.length
  const titleColumn = header[0].trim() || 'Nom'
  const properties: PropertyDef[] = [{ id: TITLE_PROPERTY_ID, name: titleColumn, type: 'title' }]
  const columns: { prop: PropertyDef; index: number; relation?: Map<string, string[]> }[] = []
  const usedNames = new Set([titleColumn])
  for (let index = 1; index < width; index += 1) {
    const values = data.map((r) => (r[index] ?? '').trim()).filter(Boolean)
    let name = header[index].trim() || `Colonne ${index + 1}`
    for (let n = 2; usedNames.has(name); n += 1)
      name = `${header[index].trim() || 'Colonne'} (${n})`
    usedNames.add(name)
    const relation = options.resolveRelation ? inferRelation(values, options.resolveRelation) : null
    const prop: PropertyDef = relation
      ? { id: newId(), name, type: 'relation', relationDatabaseId: relation.database }
      : { id: newId(), name, type: inferType(values, data.length) }
    if (prop.type === 'select' || prop.type === 'multi_select') {
      const names = prop.type === 'select' ? values : values.flatMap(splitMulti)
      prop.options = [...new Set(names)].map((n, i) => ({
        id: newId(),
        name: n,
        color: OPTION_COLORS[i % OPTION_COLORS.length]
      }))
    }
    properties.push(prop)
    columns.push({ prop, index, relation: relation?.cells })
  }
  const rows = data.map((r) => {
    const values: Record<string, PropertyValue> = {}
    for (const { prop, index, relation } of columns) {
      const text = (r[index] ?? '').trim()
      const v = relation
        ? relation.get(text)?.length
          ? relation.get(text)!
          : null
        : parseCell(prop, text)
      if (v !== null) values[prop.id] = v
    }
    return { title: (r[0] ?? '').trim(), values }
  })
  const views = [defaultView('table')]
  const firstSelect = properties.find((p) => p.type === 'select')
  if (firstSelect) views.push({ ...defaultView('board'), groupBy: firstSelect.id })
  return { schema: { properties, views }, titleColumn, rows }
}

/** Splits "A (link), B (link)" into titles and links; null when the cell is not in that form. */
export function splitLinkedCell(cell: string): { title: string; link: string }[] | null {
  const parts: { title: string; link: string }[] = []
  const re = /\s*([^,]*?)\s*\(([^()\s]+)\)\s*(?:,|$)/y
  let m: RegExpExecArray | null
  while (re.lastIndex < cell.length && (m = re.exec(cell))) parts.push({ title: m[1], link: m[2] })
  return parts.length && re.lastIndex >= cell.length ? parts : null
}

/**
 * A column is a relation when every value names rows of one same database,
 * either as "Title (link)" or as titles matching exactly one row.
 */
function inferRelation(
  values: string[],
  resolve: NonNullable<InferOptions['resolveRelation']>
): { database: string; cells: Map<string, string[]> } | null {
  if (values.length === 0) return null
  // Bare titles are weak evidence: a single cell that happens to equal a row title
  // (e.g. a description saying "AWS") must not turn a text column into a relation.
  const linkedCells = values.filter((v) => splitLinkedCell(v) !== null).length
  if (linkedCells === 0 && values.length < 2) return null
  const cells = new Map<string, string[]>()
  const databases = new Map<string, number>()
  for (const value of new Set(values)) {
    const linked = splitLinkedCell(value)
    const refs = linked ?? splitMulti(value).map((title) => ({ title, link: null }))
    const targets = refs.map((r) => resolve(r.title, r.link))
    if (targets.some((t) => t === null)) return null
    for (const t of targets as RelationTarget[])
      databases.set(t.database, (databases.get(t.database) ?? 0) + 1)
    cells.set(
      value,
      (targets as RelationTarget[]).map((t) => t.id)
    )
  }
  if (databases.size !== 1) return null
  return { database: [...databases.keys()][0], cells }
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
