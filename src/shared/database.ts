/**
 * Notion-style databases: a database is a page holding a schema (properties
 * and views); its rows are sub-pages holding property values. Everything here
 * is pure so that the main process (storage, import, export) and the renderer
 * (views) interpret values the same way.
 */

export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'relation'
  | 'created_time'
  | 'last_edited_time'
  | 'formula'
  | 'rollup'

export const OPTION_COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red'
] as const
export type OptionColor = (typeof OPTION_COLORS)[number]

export interface SelectOption {
  id: string
  name: string
  color: OptionColor
}

export interface PropertyDef {
  id: string
  name: string
  type: PropertyType
  /** select and multi_select */
  options?: SelectOption[]
  /** relation: the database whose rows can be linked */
  relationDatabaseId?: string | null
  /** formula: expression, e.g. prop("Prix") * 1.2 */
  formula?: string
  /** rollup: aggregates a property of the rows linked by a relation */
  rollup?: RollupConfig
}

export type RollupAggregate =
  | 'show_original'
  | 'count'
  | 'count_values'
  | 'count_unique'
  | 'count_empty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'percent_checked'
  | 'percent_empty'
  | 'earliest'
  | 'latest'

export interface RollupConfig {
  relationPropertyId: string | null
  /** property of the linked rows; null counts the rows themselves */
  targetPropertyId: string | null
  aggregate: RollupAggregate
}

export const ROLLUP_LABELS: Record<RollupAggregate, string> = {
  show_original: 'Afficher les valeurs',
  count: 'Nombre de lignes',
  count_values: 'Nombre de valeurs',
  count_unique: 'Nombre de valeurs uniques',
  count_empty: 'Nombre de vides',
  sum: 'Somme',
  average: 'Moyenne',
  median: 'Médiane',
  min: 'Minimum',
  max: 'Maximum',
  range: 'Écart (max − min)',
  percent_checked: 'Pourcentage coché',
  percent_empty: 'Pourcentage vide',
  earliest: 'Date la plus ancienne',
  latest: 'Date la plus récente'
}

/** Result of a formula or rollup that could not be computed. */
export interface ComputedError {
  error: string
}

/** `start`/`end` are 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (local time). */
export interface DateValue {
  start: string
  end?: string | null
}

export type PropertyValue = string | number | boolean | string[] | DateValue | ComputedError | null

export const isComputedError = (v: PropertyValue | undefined): v is ComputedError =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'error' in v

/** Formulas and rollups are computed when read, never stored. */
export const isComputed = (type: PropertyType): boolean => type === 'formula' || type === 'rollup'

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar'

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_empty'
  | 'is_not_empty'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'is_checked'
  | 'is_not_checked'

export interface Filter {
  id: string
  propertyId: string
  operator: FilterOperator
  /** text, number, option id or date ('YYYY-MM-DD'), depending on the property */
  value?: string | number | null
}

export interface Sort {
  propertyId: string
  direction: 'asc' | 'desc'
}

export interface ViewDef {
  id: string
  name: string
  type: ViewType
  filters: Filter[]
  filterMode: 'and' | 'or'
  sorts: Sort[]
  /** board: select property used for the columns */
  groupBy?: string | null
  /** calendar: date property placing the rows */
  dateProperty?: string | null
  /** properties hidden in this view (the title is always shown) */
  hidden: string[]
}

export interface DatabaseSchema {
  properties: PropertyDef[]
  views: ViewDef[]
}

export interface DatabaseRow {
  id: string
  title: string
  icon: string | null
  cover: string | null
  properties: Record<string, PropertyValue>
  isTemplate: boolean
  position: number
  createdAt: number
  updatedAt: number
}

export const TITLE_PROPERTY_ID = 'title'

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  title: 'Titre',
  text: 'Texte',
  number: 'Nombre',
  select: 'Sélection',
  multi_select: 'Sélection multiple',
  date: 'Date',
  checkbox: 'Case à cocher',
  url: 'URL',
  email: 'E-mail',
  phone: 'Téléphone',
  relation: 'Relation',
  created_time: 'Date de création',
  last_edited_time: 'Dernière modification',
  formula: 'Formule',
  rollup: 'Rollup'
}

export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  table: 'Tableau',
  board: 'Board',
  list: 'Liste',
  gallery: 'Galerie',
  calendar: 'Calendrier'
}

const PROPERTY_TYPES = new Set(Object.keys(PROPERTY_TYPE_LABELS))

export const isPropertyType = (v: unknown): v is PropertyType =>
  typeof v === 'string' && PROPERTY_TYPES.has(v)
const VIEW_TYPES = new Set(Object.keys(VIEW_TYPE_LABELS))
const COMPUTED: ReadonlySet<PropertyType> = new Set([
  'title',
  'created_time',
  'last_edited_time',
  'formula',
  'rollup'
])

export const newId = (): string => globalThis.crypto.randomUUID().slice(0, 8)

export function defaultView(type: ViewType = 'table', name = VIEW_TYPE_LABELS[type]): ViewDef {
  return { id: newId(), name, type, filters: [], filterMode: 'and', sorts: [], hidden: [] }
}

export function defaultSchema(): DatabaseSchema {
  return {
    properties: [{ id: TITLE_PROPERTY_ID, name: 'Nom', type: 'title' }],
    views: [defaultView('table')]
  }
}

// ---------------------------------------------------------------------------
// Parsing at the storage / IPC boundary

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/**
 * Reads a stored or received schema. Invalid parts are dropped; the result
 * always has exactly one title property and at least one view, and views only
 * reference existing properties.
 */
export function parseSchema(raw: unknown): DatabaseSchema {
  const input = typeof raw === 'string' ? safeJson(raw) : raw
  if (!isRecord(input)) return defaultSchema()
  const seen = new Set<string>()
  const properties: PropertyDef[] = []
  for (const p of Array.isArray(input.properties) ? input.properties : []) {
    if (!isRecord(p)) continue
    const type = str(p.type) as PropertyType
    const id = str(p.id)
    if (!id || seen.has(id) || !PROPERTY_TYPES.has(type)) continue
    if (type === 'title' && properties.some((x) => x.type === 'title')) continue
    if ((type === 'title') !== (id === TITLE_PROPERTY_ID)) continue
    seen.add(id)
    const def: PropertyDef = { id, name: str(p.name, 'Sans nom'), type }
    if (type === 'select' || type === 'multi_select') def.options = parseOptions(p.options)
    if (type === 'relation') def.relationDatabaseId = str(p.relationDatabaseId) || null
    if (type === 'formula') def.formula = str(p.formula)
    if (type === 'rollup') {
      const r = isRecord(p.rollup) ? p.rollup : {}
      def.rollup = {
        relationPropertyId: str(r.relationPropertyId) || null,
        targetPropertyId: str(r.targetPropertyId) || null,
        aggregate: (str(r.aggregate) in ROLLUP_LABELS
          ? str(r.aggregate)
          : 'count') as RollupAggregate
      }
    }
    properties.push(def)
  }
  if (!properties.some((p) => p.type === 'title')) {
    properties.unshift({ id: TITLE_PROPERTY_ID, name: 'Nom', type: 'title' })
  }
  const views: ViewDef[] = []
  const ids = new Set(properties.map((p) => p.id))
  const viewIds = new Set<string>()
  for (const v of Array.isArray(input.views) ? input.views : []) {
    if (!isRecord(v)) continue
    const type = str(v.type) as ViewType
    const id = str(v.id)
    if (!id || viewIds.has(id) || !VIEW_TYPES.has(type)) continue
    viewIds.add(id)
    const byType = (pid: unknown, wanted: PropertyType[]): string | null => {
      const prop = properties.find((p) => p.id === pid)
      return prop && wanted.includes(prop.type) ? prop.id : null
    }
    views.push({
      id,
      name: str(v.name, VIEW_TYPE_LABELS[type]),
      type,
      filterMode: v.filterMode === 'or' ? 'or' : 'and',
      filters: (Array.isArray(v.filters) ? v.filters : []).flatMap((f) =>
        // A filter whose operator does not suit the property type (e.g. after a type
        // change) is dropped instead of silently matching every row.
        isRecord(f) &&
        ids.has(str(f.propertyId)) &&
        operatorsFor(properties.find((p) => p.id === str(f.propertyId))!.type).some(
          (o) => o.op === f.operator
        )
          ? [
              {
                id: str(f.id) || newId(),
                propertyId: str(f.propertyId),
                operator: f.operator as FilterOperator,
                value: typeof f.value === 'string' || typeof f.value === 'number' ? f.value : null
              }
            ]
          : []
      ),
      sorts: (Array.isArray(v.sorts) ? v.sorts : []).flatMap((s) =>
        isRecord(s) && ids.has(str(s.propertyId))
          ? [
              {
                propertyId: str(s.propertyId),
                direction: s.direction === 'desc' ? 'desc' : 'asc'
              } as Sort
            ]
          : []
      ),
      groupBy: byType(v.groupBy, ['select', 'checkbox']),
      dateProperty: byType(v.dateProperty, ['date', 'created_time', 'last_edited_time']),
      hidden: (Array.isArray(v.hidden) ? v.hidden : []).filter(
        (h): h is string => typeof h === 'string' && ids.has(h) && h !== TITLE_PROPERTY_ID
      )
    })
  }
  if (views.length === 0) views.push(defaultView('table'))
  return { properties, views }
}

function parseOptions(raw: unknown): SelectOption[] {
  const out: SelectOption[] = []
  const seen = new Set<string>()
  for (const o of Array.isArray(raw) ? raw : []) {
    if (!isRecord(o)) continue
    const id = str(o.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const color = OPTION_COLORS.includes(o.color as OptionColor) ? (o.color as OptionColor) : 'gray'
    out.push({ id, name: str(o.name), color })
  }
  return out
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

/** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' naming a real day and time (no rollover such as Feb 30). */
export function isDateString(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  const day = new Date(y, m - 1, d)
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return false
  if (s.length === 10) return true
  const [h, min] = s.slice(11).split(':').map(Number)
  return h < 24 && min < 60
}

/**
 * Validates a value for a property; anything that does not fit becomes null.
 * Computed properties (title, created/edited time) never store a value.
 */
export function normalizeValue(prop: PropertyDef, value: unknown): PropertyValue {
  if (value === null || value === undefined || COMPUTED.has(prop.type)) return null
  switch (prop.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof value === 'string' && value !== '' ? value : null
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    case 'checkbox':
      return value === true
    case 'select': {
      const id = typeof value === 'string' ? value : null
      return id && prop.options?.some((o) => o.id === id) ? id : null
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return null
      const ids = [...new Set(value.filter((v) => typeof v === 'string'))].filter((id) =>
        prop.options?.some((o) => o.id === id)
      )
      return ids.length ? ids : null
    }
    case 'relation': {
      if (!Array.isArray(value)) return null
      const ids = [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))]
      return ids.length ? ids : null
    }
    case 'date': {
      if (!isRecord(value) || !isDateString(value.start)) return null
      const end = isDateString(value.end) && value.end >= value.start ? value.end : null
      return end ? { start: value.start, end } : { start: value.start }
    }
    default:
      return null
  }
}

/** Keeps only valid values for the current schema. */
export function parseRowProperties(
  raw: unknown,
  schema: DatabaseSchema
): Record<string, PropertyValue> {
  const input = typeof raw === 'string' ? safeJson(raw) : raw
  const out: Record<string, PropertyValue> = {}
  if (!isRecord(input)) return out
  for (const prop of schema.properties) {
    const v = normalizeValue(prop, input[prop.id])
    if (v !== null) out[prop.id] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading values

export function rowValue(row: DatabaseRow, prop: PropertyDef): PropertyValue {
  switch (prop.type) {
    case 'title':
      return row.title
    case 'created_time':
      return { start: localDateTime(row.createdAt) }
    case 'last_edited_time':
      return { start: localDateTime(row.updatedAt) }
    default:
      return row.properties[prop.id] ?? null
  }
}

export function localDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const isEmpty = (value: PropertyValue): boolean =>
  value === null ||
  value === '' ||
  value === false ||
  (Array.isArray(value) && value.length === 0) ||
  isComputedError(value)

const isDateValue = (v: PropertyValue): v is DateValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'start' in v

/** Display of a computed value, whose type depends on the formula or rollup. */
function displayComputed(value: PropertyValue): string {
  if (value === null) return ''
  if (isComputedError(value)) return `⚠ ${value.error}`
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  if (typeof value === 'number') return String(Math.round(value * 1e10) / 1e10)
  if (Array.isArray(value)) return value.join(', ')
  if (isDateValue(value))
    return value.end
      ? `${value.start.replace('T', ' ')} → ${value.end.replace('T', ' ')}`
      : value.start.replace('T', ' ')
  return value
}

/** Filters on computed values follow the type of each value. */
function matchesComputed(value: PropertyValue, filter: Filter): boolean {
  const target = filter.value
  if (target === null || target === undefined || target === '') return true
  const op = filter.operator
  if (typeof value === 'number') {
    const n = typeof target === 'number' ? target : Number(String(target).replace(',', '.'))
    if (Number.isFinite(n)) {
      if (op === 'equals') return value === n
      if (op === 'not_equals') return value !== n
      if (op === 'gt') return value > n
      if (op === 'lt') return value < n
      if (op === 'gte') return value >= n
      if (op === 'lte') return value <= n
    }
  }
  if (isDateValue(value) && ['before', 'after', 'equals'].includes(op)) {
    const t = String(target).slice(0, 10)
    const day = value.start.slice(0, 10)
    return op === 'before' ? day < t : op === 'after' ? day > t : day === t
  }
  const text = fold(displayComputed(value))
  const wanted = fold(String(target))
  if (op === 'contains') return text.includes(wanted)
  if (op === 'not_contains') return !text.includes(wanted)
  if (op === 'equals') return text === wanted
  if (op === 'not_equals') return text !== wanted
  return false
}

function compareComputed(a: PropertyValue, b: PropertyValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (isDateValue(a) && isDateValue(b)) return a.start.localeCompare(b.start)
  return displayComputed(a).localeCompare(displayComputed(b), undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

const optionName = (prop: PropertyDef, id: string): string =>
  prop.options?.find((o) => o.id === id)?.name ?? ''

const dateText = (s: string): string => s.replace('T', ' ')

/**
 * Plain-text form of a value, used for search, CSV export and conversions.
 * `relationTitle` resolves linked page ids.
 */
export function displayValue(
  prop: PropertyDef,
  value: PropertyValue,
  relationTitle: (id: string) => string | undefined = () => undefined
): string {
  if (isComputed(prop.type)) return displayComputed(value)
  if (value === null) return ''
  switch (prop.type) {
    case 'checkbox':
      return value === true ? 'Oui' : 'Non'
    case 'select':
      return typeof value === 'string' ? optionName(prop, value) : ''
    case 'multi_select':
      return Array.isArray(value)
        ? value
            .map((id) => optionName(prop, id))
            .filter(Boolean)
            .join(', ')
        : ''
    case 'relation':
      return Array.isArray(value)
        ? value
            .map((id) => relationTitle(id) ?? '')
            .filter(Boolean)
            .join(', ')
        : ''
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const d = value as DateValue
      return d.end ? `${dateText(d.start)} → ${dateText(d.end)}` : dateText(d.start)
    }
    case 'number':
      return typeof value === 'number' ? String(value) : ''
    default:
      return typeof value === 'string' ? value : ''
  }
}

// ---------------------------------------------------------------------------
// Filters, sorts and grouping

/** Operators offered for a property type, with their French labels. */
export function operatorsFor(type: PropertyType): { op: FilterOperator; label: string }[] {
  const empty = [
    { op: 'is_empty' as const, label: 'est vide' },
    { op: 'is_not_empty' as const, label: 'n’est pas vide' }
  ]
  if (isComputed(type)) {
    return [
      { op: 'equals', label: '= / est' },
      { op: 'not_equals', label: '≠ / n’est pas' },
      { op: 'contains', label: 'contient' },
      { op: 'not_contains', label: 'ne contient pas' },
      { op: 'gt', label: '>' },
      { op: 'lt', label: '<' },
      { op: 'gte', label: '≥' },
      { op: 'lte', label: '≤' },
      { op: 'before', label: 'est avant' },
      { op: 'after', label: 'est après' },
      ...empty
    ]
  }
  switch (type) {
    case 'number':
      return [
        { op: 'equals', label: '=' },
        { op: 'not_equals', label: '≠' },
        { op: 'gt', label: '>' },
        { op: 'lt', label: '<' },
        { op: 'gte', label: '≥' },
        { op: 'lte', label: '≤' },
        ...empty
      ]
    case 'select':
      return [{ op: 'equals', label: 'est' }, { op: 'not_equals', label: 'n’est pas' }, ...empty]
    case 'relation':
      return empty
    case 'multi_select':
      return [
        { op: 'contains', label: 'contient' },
        { op: 'not_contains', label: 'ne contient pas' },
        ...empty
      ]
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return [
        { op: 'equals', label: 'est le' },
        { op: 'before', label: 'est avant' },
        { op: 'after', label: 'est après' },
        ...empty
      ]
    case 'checkbox':
      return [
        { op: 'is_checked', label: 'est cochée' },
        { op: 'is_not_checked', label: 'n’est pas cochée' }
      ]
    default:
      return [
        { op: 'contains', label: 'contient' },
        { op: 'not_contains', label: 'ne contient pas' },
        { op: 'equals', label: 'est' },
        { op: 'not_equals', label: 'n’est pas' },
        ...empty
      ]
  }
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** A filter without the value it needs is ignored (matches every row), as in Notion. */
export function matchesFilter(prop: PropertyDef, value: PropertyValue, filter: Filter): boolean {
  const op = filter.operator
  if (op === 'is_empty') return isEmpty(value)
  if (op === 'is_not_empty') return !isEmpty(value)
  if (op === 'is_checked') return value === true
  if (op === 'is_not_checked') return value !== true
  if (isComputed(prop.type)) return matchesComputed(value, filter)
  const target = filter.value
  if (target === null || target === undefined || target === '') return true
  switch (prop.type) {
    case 'number': {
      const n = typeof target === 'number' ? target : Number(String(target).replace(',', '.'))
      if (!Number.isFinite(n)) return true
      if (typeof value !== 'number') return op === 'not_equals'
      if (op === 'equals') return value === n
      if (op === 'not_equals') return value !== n
      if (op === 'gt') return value > n
      if (op === 'lt') return value < n
      if (op === 'gte') return value >= n
      if (op === 'lte') return value <= n
      return true
    }
    case 'select':
      return op === 'not_equals' ? value !== target : value === target
    case 'multi_select':
    case 'relation': {
      const has = Array.isArray(value) && value.includes(String(target))
      return op === 'not_contains' ? !has : has
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
      const day = (value as DateValue).start.slice(0, 10)
      const end = ((value as DateValue).end ?? (value as DateValue).start).slice(0, 10)
      const t = String(target).slice(0, 10)
      if (op === 'before') return day < t
      if (op === 'after') return end > t
      return day <= t && t <= end
    }
    default: {
      const text = fold(displayValue(prop, value))
      const wanted = fold(String(target))
      if (op === 'contains') return text.includes(wanted)
      if (op === 'not_contains') return !text.includes(wanted)
      if (op === 'equals') return text === wanted
      if (op === 'not_equals') return text !== wanted
      return true
    }
  }
}

/** Orders two values of a property; empty values always come last. */
export function compareValues(prop: PropertyDef, a: PropertyValue, b: PropertyValue): number {
  const ea = isEmpty(a) && prop.type !== 'checkbox'
  const eb = isEmpty(b) && prop.type !== 'checkbox'
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
  if (isComputed(prop.type)) return compareComputed(a, b)
  switch (prop.type) {
    case 'number':
      return (a as number) - (b as number)
    case 'checkbox':
      return Number(a === true) - Number(b === true)
    case 'select':
    case 'multi_select': {
      const rank = (v: PropertyValue): number => {
        const id = Array.isArray(v) ? v[0] : v
        const i = prop.options?.findIndex((o) => o.id === id) ?? -1
        return i < 0 ? Number.MAX_SAFE_INTEGER : i
      }
      return rank(a) - rank(b)
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return (a as DateValue).start.localeCompare((b as DateValue).start)
    default:
      return displayValue(prop, a).localeCompare(displayValue(prop, b), undefined, {
        numeric: true,
        sensitivity: 'base'
      })
  }
}

/** Rows shown by a view: templates excluded, filters applied, then sorts (manual order otherwise). */
export function applyView(
  rows: DatabaseRow[],
  schema: DatabaseSchema,
  view: ViewDef
): DatabaseRow[] {
  const props = new Map(schema.properties.map((p) => [p.id, p]))
  const filters = view.filters.filter((f) => props.has(f.propertyId))
  const visible = rows.filter((row) => {
    if (row.isTemplate) return false
    if (filters.length === 0) return true
    const results = filters.map((f) =>
      matchesFilter(props.get(f.propertyId)!, rowValue(row, props.get(f.propertyId)!), f)
    )
    return view.filterMode === 'or' ? results.some(Boolean) : results.every(Boolean)
  })
  const sorts = view.sorts.filter((s) => props.has(s.propertyId))
  return visible.sort((x, y) => {
    for (const s of sorts) {
      const prop = props.get(s.propertyId)!
      const a = rowValue(x, prop)
      const b = rowValue(y, prop)
      // Empty values stay last whatever the direction, as in Notion.
      const ea = isEmpty(a) && prop.type !== 'checkbox'
      const eb = isEmpty(b) && prop.type !== 'checkbox'
      if (ea !== eb) return ea ? 1 : -1
      const c = compareValues(prop, a, b)
      if (c !== 0) return s.direction === 'desc' ? -c : c
    }
    return x.position - y.position
  })
}

export interface RowGroup {
  /** option id ('true'/'false' for a checkbox), or null for rows without a value */
  key: string | null
  option: SelectOption | null
  label: string
  /** value a row takes when moved into this group */
  value: PropertyValue
  rows: DatabaseRow[]
}

/**
 * Groups of a board or of a grouped table/list: one per option of a select
 * property ("no value" first), or checked / not checked for a checkbox.
 */
export function groupRows(rows: DatabaseRow[], prop: PropertyDef): RowGroup[] {
  const groups: RowGroup[] =
    prop.type === 'checkbox'
      ? [
          { key: 'true', option: null, label: `${prop.name} : oui`, value: true, rows: [] },
          { key: 'false', option: null, label: `${prop.name} : non`, value: false, rows: [] }
        ]
      : [
          { key: null, option: null, label: `Sans ${prop.name}`, value: null, rows: [] },
          ...(prop.options ?? []).map((option) => ({
            key: option.id as string | null,
            option,
            label: option.name,
            value: option.id as PropertyValue,
            rows: [] as DatabaseRow[]
          }))
        ]
  const byKey = new Map(groups.map((g) => [g.key, g]))
  for (const row of rows) {
    const v = row.properties[prop.id]
    const key = prop.type === 'checkbox' ? String(v === true) : typeof v === 'string' ? v : null
    ;(byKey.get(key) ?? groups[0]).rows.push(row)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Parsing text input (cells, CSV import, type changes)

const TRUE_WORDS = new Set(['yes', 'true', 'oui', 'vrai', 'x', '✓', '✔', '1', 'checked'])
const FALSE_WORDS = new Set(['no', 'false', 'non', 'faux', '', '0', 'unchecked'])

export function parseCheckbox(text: string): boolean | null {
  const t = text.trim().toLowerCase()
  if (TRUE_WORDS.has(t)) return true
  if (FALSE_WORDS.has(t)) return false
  return null
}

// Regular, no-break and narrow no-break spaces (French thousands separators).
const SPACES = new RegExp('[\\s\\u00a0\\u202f]', 'g')

/** Accepts "1234.5", "1 234,5", "12%", "€12" and similar; null when not a number. */
export function parseNumber(text: string): number | null {
  const t = text
    .trim()
    .replace(SPACES, '')
    .replace(/[€$£%]/g, '')
  if (!t) return null
  const normalized = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)
    ? t.replace(/\./g, '').replace(',', '.')
    : /^-?\d+(,\d+)$/.test(t)
      ? t.replace(',', '.')
      : t.replace(/,(?=\d{3}\b)/g, '')
  if (!/^-?(\d+(\.\d+)?|\.\d+)(e-?\d+)?$/i.test(normalized)) return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  janvier: 1,
  janv: 1,
  feb: 2,
  february: 2,
  fevrier: 2,
  févr: 2,
  février: 2,
  fev: 2,
  mar: 3,
  march: 3,
  mars: 3,
  apr: 4,
  april: 4,
  avril: 4,
  avr: 4,
  may: 5,
  mai: 5,
  jun: 6,
  june: 6,
  juin: 6,
  jul: 7,
  july: 7,
  juillet: 7,
  juil: 7,
  aug: 8,
  august: 8,
  aout: 8,
  août: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septembre: 9,
  oct: 10,
  october: 10,
  octobre: 10,
  nov: 11,
  november: 11,
  novembre: 11,
  dec: 12,
  december: 12,
  decembre: 12,
  décembre: 12
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function buildDate(y: number, m: number, d: number, time?: string | null): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return null
  const date = new Date(y, m - 1, d)
  if (date.getMonth() !== m - 1) return null
  const base = `${y}-${pad2(m)}-${pad2(d)}`
  return time ? `${base}T${time}` : base
}

/** "10:30", "10:30 AM", "2:05 pm" → "HH:mm" */
function parseTime(text: string | undefined): string | null {
  if (!text) return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(text.trim())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  if (m[3]) {
    const pm = m[3].toLowerCase() === 'pm'
    if (h === 12) h = pm ? 12 : 0
    else if (pm) h += 12
  }
  return h < 24 && min < 60 ? `${pad2(h)}:${pad2(min)}` : null
}

/** One date: ISO, "14/10/2026", "October 14, 2026", "14 octobre 2026", optionally with a time. */
export function parseSingleDate(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ')
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}:\d{2}(?::\d{2})?))?/.exec(t)
  if (m) return buildDate(+m[1], +m[2], +m[3], parseTime(m[4]))
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?: (.+))?$/.exec(t)
  if (m) return buildDate(+m[3], +m[2], +m[1], parseTime(m[4]))
  m = /^([A-Za-zÀ-ÿ.]+) (\d{1,2}),? (\d{4})(?:,? (.+))?$/.exec(t)
  if (m && MONTHS[m[1].replace('.', '').toLowerCase()]) {
    return buildDate(+m[3], MONTHS[m[1].replace('.', '').toLowerCase()], +m[2], parseTime(m[4]))
  }
  m = /^(\d{1,2}) ([A-Za-zÀ-ÿ.]+) (\d{4})(?:,? (?:à )?(.+))?$/.exec(t)
  if (m && MONTHS[m[2].replace('.', '').toLowerCase()]) {
    return buildDate(+m[3], MONTHS[m[2].replace('.', '').toLowerCase()], +m[1], parseTime(m[4]))
  }
  return null
}

/** A date or a range "start → end" (Notion's CSV format). */
export function parseDate(text: string): DateValue | null {
  const [a, b] = text.split(/\s*(?:→|->)\s*/)
  const start = parseSingleDate(a ?? '')
  if (!start) return null
  const end = b ? parseSingleDate(b) : null
  return end && end >= start ? { start, end } : { start }
}

export const splitMulti = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Converts every row's value of `propId` to `type`. Returns the new property
 * definition (new options are created for select types) and the new values.
 */
export function convertProperty(
  prop: PropertyDef,
  type: PropertyType,
  rows: DatabaseRow[],
  relationTitle?: (id: string) => string | undefined
): { property: PropertyDef; values: Map<string, PropertyValue> } {
  const texts = new Map(
    rows.map((r) => [r.id, displayValue(prop, rowValue(r, prop), relationTitle)])
  )
  const property: PropertyDef = { id: prop.id, name: prop.name, type }
  const values = new Map<string, PropertyValue>()
  if (type === 'select' || type === 'multi_select') {
    const options: SelectOption[] = [...(prop.options ?? [])]
    const optionFor = (name: string): string => {
      const existing = options.find((o) => o.name === name)
      if (existing) return existing.id
      const option = {
        id: newId(),
        name,
        color: OPTION_COLORS[options.length % OPTION_COLORS.length]
      }
      options.push(option)
      return option.id
    }
    for (const row of rows) {
      const names =
        prop.type === 'multi_select' || type === 'multi_select'
          ? splitMulti(texts.get(row.id) ?? '')
          : [(texts.get(row.id) ?? '').trim()].filter(Boolean)
      const ids = names.map(optionFor)
      values.set(row.id, type === 'select' ? (ids[0] ?? null) : ids.length ? ids : null)
    }
    const used = new Set([...values.values()].flat())
    property.options = options.filter(
      (o) => used.has(o.id) || prop.options?.some((p) => p.id === o.id)
    )
    return { property, values }
  }
  if (type === 'relation') property.relationDatabaseId = prop.relationDatabaseId ?? null
  if (type === 'formula') property.formula = prop.formula ?? ''
  if (type === 'rollup')
    property.rollup = prop.rollup ?? {
      relationPropertyId: null,
      targetPropertyId: null,
      aggregate: 'count'
    }
  for (const row of rows) {
    const text = texts.get(row.id) ?? ''
    let value: PropertyValue = null
    if (prop.type === 'relation' && type === 'relation') value = row.properties[prop.id] ?? null
    else if (type === 'number') value = parseNumber(text)
    else if (type === 'checkbox') value = parseCheckbox(text) ?? (text !== '' ? true : false)
    else if (type === 'date') value = parseDate(text)
    else if (type === 'text' || type === 'url' || type === 'email' || type === 'phone')
      value = text || null
    values.set(row.id, normalizeValue(property, value))
  }
  return { property, values }
}
