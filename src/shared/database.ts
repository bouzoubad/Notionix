/**
 * Notion-style databases: a database is a page holding a schema (properties
 * and views); its rows are sub-pages holding property values. Everything here
 * is pure so that the main process (storage, import, export) and the renderer
 * (views) interpret values the same way.
 */
import { locale, t } from './i18n'

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
  | 'person'
  | 'files'
  | 'status'
  | 'created_by'
  | 'last_edited_by'
  | 'unique_id'

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
  /** status: the stage the option belongs to */
  group?: StatusGroup
}

export type StatusGroup = 'todo' | 'in_progress' | 'done'
export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  todo: t('À faire'),
  in_progress: t('En cours'),
  done: t('Terminé')
}

export interface PropertyDef {
  id: string
  name: string
  type: PropertyType
  /** select and multi_select */
  options?: SelectOption[]
  /** relation: the database whose rows can be linked */
  relationDatabaseId?: string | null
  /** relation: the property of the linked database kept in step (two-way relation) */
  syncedPropertyId?: string | null
  /** unique_id: text before the number (e.g. "TÂCHE") */
  idPrefix?: string
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
  show_original: t('Afficher les valeurs'),
  count: t('Nombre de lignes'),
  count_values: t('Nombre de valeurs'),
  count_unique: t('Nombre de valeurs uniques'),
  count_empty: t('Nombre de vides'),
  sum: t('Somme'),
  average: t('Moyenne'),
  median: t('Médiane'),
  min: t('Minimum'),
  max: t('Maximum'),
  range: t('Écart (max − min)'),
  percent_checked: t('Pourcentage coché'),
  percent_empty: t('Pourcentage vide'),
  earliest: t('Date la plus ancienne'),
  latest: t('Date la plus récente')
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

export type ViewType =
  'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'chart' | 'form'

export type ChartType = 'bar' | 'hbar' | 'stacked' | 'line' | 'area' | 'donut' | 'pie' | 'number'
export const CHART_TYPES: ChartType[] = [
  'bar',
  'hbar',
  'stacked',
  'line',
  'area',
  'donut',
  'pie',
  'number'
]
export type ChartAggregate = 'count' | 'sum' | 'average' | 'median' | 'min' | 'max'

export type CalcKind =
  | 'count_all'
  | 'count_values'
  | 'count_empty'
  | 'count_unique'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'earliest'
  | 'latest'
  | 'checked'
  | 'unchecked'
  | 'percent_checked'

export const CALC_LABELS: Record<CalcKind, string> = {
  count_all: t('Tout compter'),
  count_values: t('Compter les valeurs'),
  count_empty: t('Compter les vides'),
  count_unique: t('Valeurs uniques'),
  percent_empty: t('Pourcentage vide'),
  percent_not_empty: t('Pourcentage rempli'),
  sum: t('Somme'),
  average: t('Moyenne'),
  median: t('Médiane'),
  min: t('Minimum'),
  max: t('Maximum'),
  range: t('Écart'),
  earliest: t('Date la plus ancienne'),
  latest: t('Date la plus récente'),
  checked: t('Cochées'),
  unchecked: t('Non cochées'),
  percent_checked: t('Pourcentage coché')
}

export interface ChartConfig {
  type: ChartType
  /** property whose values make the bars or slices */
  groupBy: string | null
  /** 'count' counts rows; the others use `valueProperty` (a number) */
  aggregate: ChartAggregate
  valueProperty: string | null
  /** Stacked bars: the property splitting each bar */
  stackBy?: string | null
  /** Line and area: running total */
  cumulative?: boolean
}

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

/** Filters combined together, then with the view's other filters (nested conditions). */
export interface FilterGroup {
  id: string
  mode: 'and' | 'or'
  filters: Filter[]
}

/** Dates relative to today, written '@today', '@this_week'… as a filter value. */
export const RELATIVE_DATES: Record<string, string> = {
  '@today': t('Aujourd’hui'),
  '@tomorrow': t('Demain'),
  '@yesterday': t('Hier'),
  '@this_week': t('Cette semaine'),
  '@last_week': t('La semaine dernière'),
  '@next_week': t('La semaine prochaine'),
  '@this_month': t('Ce mois-ci'),
  '@last_month': t('Le mois dernier'),
  '@next_month': t('Le mois prochain'),
  '@past_7': t('Les 7 derniers jours'),
  '@next_7': t('Les 7 prochains jours'),
  '@past_30': t('Les 30 derniers jours'),
  '@next_30': t('Les 30 prochains jours')
}

/** First and last day ('YYYY-MM-DD') a relative date stands for, today being `now`. */
export function relativeRange(token: string, now = new Date()): [string, string] | null {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const iso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const day = (offset: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  // Weeks start on Monday.
  const monday = (weeks: number): Date => day(-((now.getDay() + 6) % 7) + weeks * 7)
  const month = (offset: number): [string, string] => [
    iso(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0))
  ]
  switch (token) {
    case '@today':
      return [iso(day(0)), iso(day(0))]
    case '@tomorrow':
      return [iso(day(1)), iso(day(1))]
    case '@yesterday':
      return [iso(day(-1)), iso(day(-1))]
    case '@this_week':
      return [iso(monday(0)), iso(new Date(monday(0).getTime() + 6 * 86_400_000))]
    case '@last_week':
      return [iso(monday(-1)), iso(new Date(monday(-1).getTime() + 6 * 86_400_000))]
    case '@next_week':
      return [iso(monday(1)), iso(new Date(monday(1).getTime() + 6 * 86_400_000))]
    case '@this_month':
      return month(0)
    case '@last_month':
      return month(-1)
    case '@next_month':
      return month(1)
    case '@past_7':
      return [iso(day(-7)), iso(day(0))]
    case '@next_7':
      return [iso(day(0)), iso(day(7))]
    case '@past_30':
      return [iso(day(-30)), iso(day(0))]
    case '@next_30':
      return [iso(day(0)), iso(day(30))]
    default:
      return null
  }
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
  /** Groups of filters, each one counting as one condition of the view */
  filterGroups?: FilterGroup[]
  sorts: Sort[]
  /** board: select property used for the columns */
  groupBy?: string | null
  /** calendar and timeline: date property placing the rows */
  dateProperty?: string | null
  /** timeline: width of a day */
  timelineScale?: 'week' | 'month'
  /** table: calculation shown under each column */
  calculations?: Record<string, CalcKind>
  /** table: column widths in pixels */
  widths?: Record<string, number>
  /** table: long values wrap instead of being cut */
  wrap?: boolean
  /** table: the title column stays visible when scrolling sideways */
  freezeTitle?: boolean
  /** form: public link letting anyone fill the form without an account (server) */
  formToken?: string | null
  /** board, table and list: second grouping inside each group (table and list) */
  subGroupBy?: string | null
  chart?: ChartConfig
  /** properties hidden in this view (the title is always shown) */
  hidden: string[]
}

export interface DatabaseSchema {
  properties: PropertyDef[]
  views: ViewDef[]
  /** Sub-items: rows nest under the row named by `parentPropertyId` */
  subItems?: { parentPropertyId: string; childrenPropertyId: string } | null
  /** Dependencies: rows blocked by other rows */
  dependencies?: { blockedByPropertyId: string; blockingPropertyId: string } | null
  /** Views and properties locked: rows stay editable (and select options can be added) */
  locked?: boolean
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
  createdBy: string | null
  updatedBy: string | null
}

export const TITLE_PROPERTY_ID = 'title'

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  title: t('Titre'),
  text: t('Texte'),
  number: t('Nombre'),
  select: t('Sélection'),
  multi_select: t('Sélection multiple'),
  date: t('Date'),
  checkbox: t('Case à cocher'),
  url: t('URL'),
  email: t('E-mail'),
  phone: t('Téléphone'),
  relation: t('Relation'),
  created_time: t('Date de création'),
  last_edited_time: t('Dernière modification'),
  formula: t('Formule'),
  rollup: t('Rollup'),
  person: t('Personne'),
  files: t('Fichiers et médias'),
  status: t('Statut'),
  created_by: t('Créé par'),
  last_edited_by: t('Modifié par'),
  unique_id: t('Identifiant')
}

/** Names of the view types, in French (translated where used). */
const VIEW_TYPE_NAMES: Record<ViewType, string> = {
  table: 'Tableau',
  board: 'Board',
  list: 'Liste',
  gallery: 'Galerie',
  calendar: 'Calendrier',
  timeline: 'Chronologie',
  chart: 'Graphique',
  form: 'Formulaire'
}
export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  table: t('Tableau'),
  board: t('Board'),
  list: t('Liste'),
  gallery: t('Galerie'),
  calendar: t('Calendrier'),
  timeline: t('Chronologie'),
  chart: t('Graphique'),
  form: t('Formulaire')
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
  'rollup',
  'created_by',
  'last_edited_by'
])

/** Types whose value is set by Notionix, never typed in a cell. */
export const READ_ONLY_TYPES: ReadonlySet<PropertyType> = new Set([
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'unique_id'
])

/** Options of a new status property. */
export const defaultStatusOptions = (): SelectOption[] => [
  { id: newId(), name: t('Pas commencé'), color: 'gray', group: 'todo' },
  { id: newId(), name: t('En cours'), color: 'blue', group: 'in_progress' },
  { id: newId(), name: t('Terminé'), color: 'green', group: 'done' }
]

/**
 * Random id. crypto.getRandomValues works everywhere, unlike randomUUID,
 * which browsers only offer over HTTPS (or on localhost).
 */
export function randomId(length = 8): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('')
}

export const newId = (): string => randomId(8)

/**
 * A new view, named after its type in the current language (read now: on the
 * desktop app's main process and on the server, the language is set per use).
 */
export function defaultView(type: ViewType = 'table', name = t(VIEW_TYPE_NAMES[type])): ViewDef {
  return { id: newId(), name, type, filters: [], filterMode: 'and', sorts: [], hidden: [] }
}

export function defaultSchema(): DatabaseSchema {
  return {
    properties: [{ id: TITLE_PROPERTY_ID, name: t('Nom'), type: 'title' }],
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
    const def: PropertyDef = { id, name: str(p.name, t('Sans nom')), type }
    if (type === 'select' || type === 'multi_select' || type === 'status')
      def.options = parseOptions(p.options, type === 'status')
    if (type === 'relation') {
      def.relationDatabaseId = str(p.relationDatabaseId) || null
      def.syncedPropertyId = str(p.syncedPropertyId) || null
    }
    if (type === 'unique_id') def.idPrefix = str(p.idPrefix).slice(0, 20)
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
    properties.unshift({ id: TITLE_PROPERTY_ID, name: t('Nom'), type: 'title' })
  }
  const views: ViewDef[] = []
  const ids = new Set(properties.map((p) => p.id))
  // A filter whose operator does not suit the property type (e.g. after a type
  // change) is dropped instead of silently matching every row.
  const parseFilters = (raw: unknown): Filter[] =>
    (Array.isArray(raw) ? raw : []).flatMap((f) =>
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
    )
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
      filterGroups: (Array.isArray(v.filterGroups) ? v.filterGroups : []).flatMap((g) =>
        isRecord(g)
          ? [
              {
                id: str(g.id) || newId(),
                mode: g.mode === 'or' ? ('or' as const) : ('and' as const),
                filters: parseFilters(g.filters)
              }
            ]
          : []
      ),
      filters: parseFilters(v.filters),
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
      groupBy: byType(v.groupBy, GROUPABLE_TYPES),
      dateProperty: byType(v.dateProperty, ['date', 'created_time', 'last_edited_time']),
      timelineScale: v.timelineScale === 'month' ? 'month' : 'week',
      calculations: parseCalculations(v.calculations, properties),
      widths: parseWidths(v.widths, ids),
      wrap: v.wrap === true,
      formToken:
        type === 'form' && typeof v.formToken === 'string' && /^[a-z0-9]{16,64}$/.test(v.formToken)
          ? v.formToken
          : null,
      freezeTitle: v.freezeTitle === true,
      subGroupBy:
        byType(v.subGroupBy, GROUPABLE_TYPES) !== byType(v.groupBy, GROUPABLE_TYPES)
          ? byType(v.subGroupBy, GROUPABLE_TYPES)
          : null,
      ...(type === 'chart' ? { chart: parseChart(v.chart, properties) } : {}),
      hidden: (Array.isArray(v.hidden) ? v.hidden : []).filter(
        (h): h is string => typeof h === 'string' && ids.has(h) && h !== TITLE_PROPERTY_ID
      )
    })
  }
  if (views.length === 0) views.push(defaultView('table'))
  const schema: DatabaseSchema = { properties, views }
  const relation = (id: unknown): string | null =>
    properties.some((p) => p.id === id && p.type === 'relation') ? (id as string) : null
  if (isRecord(input.subItems)) {
    const parent = relation(input.subItems.parentPropertyId)
    const children = relation(input.subItems.childrenPropertyId)
    if (parent && children)
      schema.subItems = { parentPropertyId: parent, childrenPropertyId: children }
  }
  if (isRecord(input.dependencies)) {
    const blockedBy = relation(input.dependencies.blockedByPropertyId)
    const blocking = relation(input.dependencies.blockingPropertyId)
    if (blockedBy && blocking)
      schema.dependencies = { blockedByPropertyId: blockedBy, blockingPropertyId: blocking }
  }
  if (input.locked === true) schema.locked = true
  return schema
}

/** Types a view can be grouped by. */
export const GROUPABLE_TYPES: PropertyType[] = [
  'select',
  'status',
  'multi_select',
  'checkbox',
  'person',
  'relation',
  'date',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by'
]

/** Calculations a property offers under its column. */
export function calculationsFor(type: PropertyType): CalcKind[] {
  const common: CalcKind[] = [
    'count_all',
    'count_values',
    'count_empty',
    'count_unique',
    'percent_empty',
    'percent_not_empty'
  ]
  if (type === 'checkbox') return ['count_all', 'checked', 'unchecked', 'percent_checked']
  if (type === 'number' || type === 'formula' || type === 'rollup' || type === 'unique_id')
    return [...common, 'sum', 'average', 'median', 'min', 'max', 'range']
  if (type === 'date' || type === 'created_time' || type === 'last_edited_time')
    return [...common, 'earliest', 'latest', 'range']
  return common
}

function parseCalculations(raw: unknown, properties: PropertyDef[]): Record<string, CalcKind> {
  const out: Record<string, CalcKind> = {}
  if (!isRecord(raw)) return out
  for (const prop of properties) {
    const kind = raw[prop.id]
    if (typeof kind === 'string' && calculationsFor(prop.type).includes(kind as CalcKind))
      out[prop.id] = kind as CalcKind
  }
  return out
}

function parseWidths(raw: unknown, ids: Set<string>): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isRecord(raw)) return out
  for (const [id, w] of Object.entries(raw))
    if (ids.has(id) && typeof w === 'number' && Number.isFinite(w))
      out[id] = Math.min(800, Math.max(60, Math.round(w)))
  return out
}

/**
 * Result shown under a column: a count, a percentage, a number or a date.
 * Empty when there is nothing to compute.
 */
export function calculate(
  rows: DatabaseRow[],
  prop: PropertyDef,
  kind: CalcKind,
  nameOf: (id: string) => string | undefined = () => undefined
): string {
  const values = rows.map((r) => rowValue(r, prop))
  const filled = values.filter((v) => !isEmpty(v) || (prop.type === 'checkbox' && v === true))
  const pct = (n: number): string =>
    t('{n} %', { n: rows.length ? Math.round((n / rows.length) * 100) : 0 })
  const fmt = (n: number): string => (Math.round(n * 100) / 100).toLocaleString(locale())
  const numbers = values
    .map((v) => (typeof v === 'number' ? v : null))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)
  const days = values.flatMap((v) => (isDateValue(v) ? [v.start] : [])).sort()
  switch (kind) {
    case 'count_all':
      return String(rows.length)
    case 'count_values':
      return String(filled.length)
    case 'count_empty':
      return String(rows.length - filled.length)
    case 'count_unique':
      return String(new Set(filled.map((v) => displayValue(prop, v, nameOf))).size)
    case 'percent_empty':
      return pct(rows.length - filled.length)
    case 'percent_not_empty':
      return pct(filled.length)
    case 'checked':
      return String(values.filter((v) => v === true).length)
    case 'unchecked':
      return String(values.filter((v) => v !== true).length)
    case 'percent_checked':
      return pct(values.filter((v) => v === true).length)
    case 'earliest':
      return days.length ? dateText(days[0]) : ''
    case 'latest':
      return days.length ? dateText(days[days.length - 1]) : ''
    default:
      break
  }
  if (kind === 'range' && days.length && !numbers.length) {
    const ms =
      new Date(days[days.length - 1].slice(0, 10)).getTime() -
      new Date(days[0].slice(0, 10)).getTime()
    return t('{n} j', { n: Math.round(ms / 86_400_000) })
  }
  if (!numbers.length) return ''
  const sum = numbers.reduce((s, n) => s + n, 0)
  switch (kind) {
    case 'sum':
      return fmt(sum)
    case 'average':
      return fmt(sum / numbers.length)
    case 'median': {
      const mid = Math.floor(numbers.length / 2)
      return fmt(numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2)
    }
    case 'min':
      return fmt(numbers[0])
    case 'max':
      return fmt(numbers[numbers.length - 1])
    case 'range':
      return fmt(numbers[numbers.length - 1] - numbers[0])
    default:
      return ''
  }
}

function parseChart(raw: unknown, properties: PropertyDef[]): ChartConfig {
  const c = isRecord(raw) ? raw : {}
  const has = (id: unknown, types?: PropertyType[]): string | null => {
    const p = properties.find((x) => x.id === id)
    return p && (!types || types.includes(p.type)) ? p.id : null
  }
  const aggregates: ChartAggregate[] = ['count', 'sum', 'average', 'median', 'min', 'max']
  const aggregate = aggregates.includes(c.aggregate as ChartAggregate)
    ? (c.aggregate as ChartAggregate)
    : 'count'
  const stackBy = has(c.stackBy)
  return {
    type: CHART_TYPES.includes(c.type as ChartType) ? (c.type as ChartType) : 'bar',
    groupBy: has(c.groupBy),
    aggregate,
    valueProperty: has(c.valueProperty, ['number', 'formula', 'rollup']),
    ...(stackBy ? { stackBy } : {}),
    ...(c.cumulative === true ? { cumulative: true } : {})
  }
}

function parseOptions(raw: unknown, status = false): SelectOption[] {
  const out: SelectOption[] = []
  const seen = new Set<string>()
  for (const o of Array.isArray(raw) ? raw : []) {
    if (!isRecord(o)) continue
    const id = str(o.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const color = OPTION_COLORS.includes(o.color as OptionColor) ? (o.color as OptionColor) : 'gray'
    const option: SelectOption = { id, name: str(o.name), color }
    if (status) option.group = o.group === 'in_progress' || o.group === 'done' ? o.group : 'todo'
    out.push(option)
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
    case 'select':
    case 'status': {
      const id = typeof value === 'string' ? value : null
      return id && prop.options?.some((o) => o.id === id) ? id : null
    }
    case 'person': {
      if (!Array.isArray(value)) return null
      const ids = [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))]
      return ids.length ? ids : null
    }
    case 'files': {
      if (!Array.isArray(value)) return null
      const files = value.filter(
        (v): v is string =>
          typeof v === 'string' && /^(notionix-asset:\/\/file\/|https?:\/\/)/.test(v)
      )
      return files.length ? files : null
    }
    case 'unique_id':
      return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
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
    case 'created_by':
      return row.createdBy ? [row.createdBy] : null
    case 'last_edited_by':
      return row.updatedBy ? [row.updatedBy] : null
    default:
      return row.properties[prop.id] ?? null
  }
}

/** A file of a files property: its stored src and its name (after '#'). */
export function fileEntry(value: string): { src: string; name: string } {
  const i = value.indexOf('#')
  if (i < 0) return { src: value, name: value.split('/').pop() ?? t('Fichier') }
  return { src: value.slice(0, i), name: decodeURIComponent(value.slice(i + 1)) || t('Fichier') }
}
export const fileValue = (src: string, name: string): string => `${src}#${encodeURIComponent(name)}`

/** "TÂCHE-12", or "12" without a prefix. */
export const uniqueIdText = (prop: PropertyDef, n: number): string =>
  prop.idPrefix ? `${prop.idPrefix}-${n}` : String(n)

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
  if (typeof value === 'boolean') return value ? t('Oui') : t('Non')
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
    const wantedDay = String(target).slice(0, 10)
    const day = value.start.slice(0, 10)
    return op === 'before' ? day < wantedDay : op === 'after' ? day > wantedDay : day === wantedDay
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
      return value === true ? t('Oui') : t('Non')
    case 'select':
    case 'status':
      return typeof value === 'string' ? optionName(prop, value) : ''
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return Array.isArray(value)
        ? value
            .map((id) => relationTitle(id) ?? '')
            .filter(Boolean)
            .join(', ')
        : ''
    case 'files':
      return Array.isArray(value) ? value.map((v) => fileEntry(v).name).join(', ') : ''
    case 'unique_id':
      return typeof value === 'number' ? uniqueIdText(prop, value) : ''
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

/** Operators offered for a property type, with their labels. */
export function operatorsFor(type: PropertyType): { op: FilterOperator; label: string }[] {
  const empty = [
    { op: 'is_empty' as const, label: t('est vide') },
    { op: 'is_not_empty' as const, label: t('n’est pas vide') }
  ]
  if (isComputed(type)) {
    return [
      { op: 'equals', label: t('= / est') },
      { op: 'not_equals', label: t('≠ / n’est pas') },
      { op: 'contains', label: t('contient') },
      { op: 'not_contains', label: t('ne contient pas') },
      { op: 'gt', label: '>' },
      { op: 'lt', label: '<' },
      { op: 'gte', label: '≥' },
      { op: 'lte', label: '≤' },
      { op: 'before', label: t('est avant') },
      { op: 'after', label: t('est après') },
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
    case 'status':
      return [
        { op: 'equals', label: t('est') },
        { op: 'not_equals', label: t('n’est pas') },
        ...empty
      ]
    case 'relation':
    case 'files':
      return empty
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return [
        { op: 'contains', label: t('contient') },
        { op: 'not_contains', label: t('ne contient pas') },
        ...empty
      ]
    case 'unique_id':
      return [
        { op: 'equals', label: '=' },
        { op: 'gt', label: '>' },
        { op: 'lt', label: '<' }
      ]
    case 'multi_select':
      return [
        { op: 'contains', label: t('contient') },
        { op: 'not_contains', label: t('ne contient pas') },
        ...empty
      ]
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return [
        { op: 'equals', label: t('est le') },
        { op: 'before', label: t('est avant') },
        { op: 'after', label: t('est après') },
        ...empty
      ]
    case 'checkbox':
      return [
        { op: 'is_checked', label: t('est cochée') },
        { op: 'is_not_checked', label: t('n’est pas cochée') }
      ]
    default:
      return [
        { op: 'contains', label: t('contient') },
        { op: 'not_contains', label: t('ne contient pas') },
        { op: 'equals', label: t('est') },
        { op: 'not_equals', label: t('n’est pas') },
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
    case 'status':
      return op === 'not_equals' ? value !== target : value === target
    case 'unique_id': {
      const n = Number(String(target).replace(/^\D*-?/, ''))
      if (!Number.isFinite(n) || typeof value !== 'number') return true
      return op === 'gt' ? value > n : op === 'lt' ? value < n : value === n
    }
    case 'person':
    case 'created_by':
    case 'last_edited_by':
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
      // A relative date ('@this_week'…) is a range of days; an exact date, one day.
      const range = relativeRange(String(target))
      const [from, to] = range ?? [String(target).slice(0, 10), String(target).slice(0, 10)]
      if (op === 'before') return day < from
      if (op === 'after') return end > to
      return day <= to && from <= end
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
    case 'unique_id':
      return (a as number) - (b as number)
    case 'checkbox':
      return Number(a === true) - Number(b === true)
    case 'select':
    case 'status':
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
  const groups = (view.filterGroups ?? [])
    .map((g) => ({ ...g, filters: g.filters.filter((f) => props.has(f.propertyId)) }))
    .filter((g) => g.filters.length > 0)
  const match = (row: DatabaseRow, f: Filter): boolean =>
    matchesFilter(props.get(f.propertyId)!, rowValue(row, props.get(f.propertyId)!), f)
  const visible = rows.filter((row) => {
    if (row.isTemplate) return false
    // Each group counts as one condition, combined with the view's own filters.
    const results = [
      ...filters.map((f) => match(row, f)),
      ...groups.map((g) =>
        g.mode === 'or'
          ? g.filters.some((f) => match(row, f))
          : g.filters.every((f) => match(row, f))
      )
    ]
    if (results.length === 0) return true
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
 * Groups of a board or of a grouped table/list: one per option (select,
 * status, multi-select), checked / not checked, one per person or linked
 * page, or one per month for dates. A row with several values (multi-select,
 * people, relations) appears in each of their groups. `nameOf` names people
 * and pages.
 */
export function groupRows(
  rows: DatabaseRow[],
  prop: PropertyDef,
  nameOf: (id: string) => string | undefined = () => undefined
): RowGroup[] {
  const empty: RowGroup = {
    key: null,
    option: null,
    label: t('Sans {name}', { name: prop.name }),
    value: null,
    rows: []
  }
  if (prop.type === 'checkbox') {
    const groups: RowGroup[] = [
      {
        key: 'true',
        option: null,
        label: t('{name} : oui', { name: prop.name }),
        value: true,
        rows: []
      },
      {
        key: 'false',
        option: null,
        label: t('{name} : non', { name: prop.name }),
        value: false,
        rows: []
      }
    ]
    for (const row of rows) groups[row.properties[prop.id] === true ? 0 : 1].rows.push(row)
    return groups
  }
  if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') {
    const groups: RowGroup[] = [
      empty,
      ...(prop.options ?? []).map((option) => ({
        key: option.id as string | null,
        option,
        label: option.name,
        value: (prop.type === 'multi_select' ? [option.id] : option.id) as PropertyValue,
        rows: [] as DatabaseRow[]
      }))
    ]
    const byKey = new Map(groups.map((g) => [g.key, g]))
    for (const row of rows) {
      const v = row.properties[prop.id]
      const keys = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
      const targets = keys.map((k) => byKey.get(k)).filter((g): g is RowGroup => !!g)
      for (const g of targets.length ? targets : [empty]) g.rows.push(row)
    }
    // A status without value has no "no value" column when every row has one.
    return prop.type === 'status' && empty.rows.length === 0 ? groups.slice(1) : groups
  }
  if (prop.type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time') {
    // One group per month, in order; moving a row sets the 1st of the month (dates only).
    const months = new Map<string, RowGroup>()
    for (const row of rows) {
      const v = rowValue(row, prop)
      if (!isDateValue(v)) {
        empty.rows.push(row)
        continue
      }
      const key = v.start.slice(0, 7)
      if (!months.has(key)) {
        const [y, m] = key.split('-').map(Number)
        months.set(key, {
          key,
          option: null,
          label: new Date(y, m - 1, 1).toLocaleDateString(locale(), {
            month: 'long',
            year: 'numeric'
          }),
          value: prop.type === 'date' ? { start: `${key}-01` } : null,
          rows: []
        })
      }
      months.get(key)!.rows.push(row)
    }
    const sorted = [...months.values()].sort((x, y) => (x.key! < y.key! ? -1 : 1))
    return [...sorted, empty]
  }
  // People, "created by", relations: one group per person or linked page.
  const lists = rows.map((r) => {
    const v = rowValue(r, prop)
    return Array.isArray(v) ? (v as string[]) : []
  })
  const ids = [...new Set(lists.flat())]
  const editable = prop.type === 'person' || prop.type === 'relation'
  const groups: RowGroup[] = [
    empty,
    ...ids.map((id) => ({
      key: id as string | null,
      option: null,
      label: nameOf(id) ?? t('Inconnu'),
      value: (editable ? [id] : null) as PropertyValue,
      rows: [] as DatabaseRow[]
    }))
  ]
  const byKey = new Map(groups.map((g) => [g.key, g]))
  rows.forEach((row, i) => {
    if (!lists[i].length) empty.rows.push(row)
    for (const id of lists[i]) byKey.get(id)!.rows.push(row)
  })
  return groups
}

/**
 * Three-way merge of a schema changed by this person (`base` → `next`) into
 * the schema stored now (`current`), which others may have changed meanwhile:
 * properties and views are merged by id, so both sets of changes are kept.
 */
export function mergeSchema(
  base: DatabaseSchema,
  next: DatabaseSchema,
  current: DatabaseSchema
): DatabaseSchema {
  const mergeList = <T extends { id: string }>(b: T[], n: T[], c: T[]): T[] => {
    const inBase = new Map(b.map((x) => [x.id, JSON.stringify(x)]))
    const inNext = new Map(n.map((x) => [x.id, x]))
    const out: T[] = []
    for (const item of c) {
      const mine = inNext.get(item.id)
      // Removed by this person: dropped; changed by this person: their version.
      if (!mine && inBase.has(item.id)) continue
      out.push(mine && JSON.stringify(mine) !== inBase.get(item.id) ? mine : item)
    }
    // Added by this person, at their position.
    n.forEach((item, i) => {
      if (inBase.has(item.id) || out.some((x) => x.id === item.id)) return
      const after = i > 0 ? out.findIndex((x) => x.id === n[i - 1].id) : -1
      out.splice(after + 1, 0, item)
    })
    // The order this person gave to the items both know.
    const order = new Map(n.map((x, i) => [x.id, i]))
    const known = out
      .filter((x) => order.has(x.id))
      .sort((x, y) => order.get(x.id)! - order.get(y.id)!)
    let k = 0
    return out.map((x) => (order.has(x.id) ? known[k++] : x))
  }
  const changed = (key: 'subItems' | 'dependencies'): boolean =>
    JSON.stringify(base[key] ?? null) !== JSON.stringify(next[key] ?? null)
  return {
    properties: mergeList(base.properties, next.properties, current.properties),
    views: mergeList(base.views, next.views, current.views),
    subItems: changed('subItems') ? next.subItems : current.subItems,
    dependencies: changed('dependencies') ? next.dependencies : current.dependencies,
    ...((base.locked ?? false) !== (next.locked ?? false)
      ? next.locked
        ? { locked: true }
        : {}
      : current.locked
        ? { locked: true }
        : {})
  }
}

/**
 * What a locked database still accepts: unlocking it, and new options of its
 * select, multi-select and status properties (typed while filling rows).
 */
export function allowedWhileLocked(current: DatabaseSchema, next: DatabaseSchema): boolean {
  if (!next.locked) return true
  const withoutNewOptions = {
    ...next,
    properties: next.properties.map((p) => {
      const before = current.properties.find((c) => c.id === p.id)
      if (!p.options || !before?.options) return p
      const known = new Set(before.options.map((o) => o.id))
      return { ...p, options: p.options.filter((o) => known.has(o.id)) }
    })
  }
  return JSON.stringify(withoutNewOptions) === JSON.stringify(current)
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
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    const options: SelectOption[] = [...(prop.options ?? [])]
    if (type === 'status' && options.length === 0) options.push(...defaultStatusOptions())
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
      values.set(row.id, type === 'multi_select' ? (ids.length ? ids : null) : (ids[0] ?? null))
    }
    const used = new Set([...values.values()].flat())
    property.options = options
      .filter(
        (o) =>
          used.has(o.id) ||
          prop.options?.some((p) => p.id === o.id) ||
          (type === 'status' && o.group !== undefined)
      )
      .map((o) =>
        type === 'status'
          ? { ...o, group: o.group ?? 'todo' }
          : { id: o.id, name: o.name, color: o.color }
      )
    return { property, values }
  }
  if (type === 'relation') property.relationDatabaseId = prop.relationDatabaseId ?? null
  if (type === 'unique_id') property.idPrefix = ''
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
    else if (prop.type === 'person' && type === 'person') value = row.properties[prop.id] ?? null
    else if (type === 'person' || type === 'files' || type === 'unique_id') value = null
    else if (type === 'number') value = parseNumber(text)
    else if (type === 'checkbox') value = parseCheckbox(text) ?? (text !== '' ? true : false)
    else if (type === 'date') value = parseDate(text)
    else if (type === 'text' || type === 'url' || type === 'email' || type === 'phone')
      value = text || null
    values.set(row.id, normalizeValue(property, value))
  }
  return { property, values }
}
