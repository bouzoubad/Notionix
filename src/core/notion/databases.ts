import { createHash } from 'crypto'
import {
  TITLE_PROPERTY_ID,
  defaultView,
  fileValue,
  type DatabaseSchema,
  type Filter,
  type FilterGroup,
  type FilterOperator,
  type OptionColor,
  type PropertyDef,
  type PropertyType,
  type PropertyValue,
  type RollupAggregate,
  type SelectOption,
  type Sort,
  type StatusGroup,
  type ViewDef,
  type ViewType
} from '../../shared/database'
import { notionDate, plainText } from './convert'
import type { DataSourceSnapshot } from './crawl'
import type { NotionFile, NotionPage, NotionPropertySchema, NotionView } from './types'

/** Ids made from Notion's, so that running the migration again gives the same ones. */
export function stableId(...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest()
  return Array.from(digest.subarray(0, 8), (b) => (b % 36).toString(36)).join('')
}

/** A UUID made from a text (pages Notionix creates for Notion blocks, e.g. synced blocks). */
export function stableUuid(text: string): string {
  const h = createHash('sha256').update(text).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export interface DatabaseContext {
  /** Notionix page id of the database holding a Notion data source */
  databaseOfSource(dataSourceId: string): string | null
  /** The schema of another data source (relations and rollups name its properties) */
  sourceSchema(dataSourceId: string): Record<string, NotionPropertySchema> | null
  pageId(notionId: string): string | null
  userId(notionUserId: string): string | null
  asset(url: string, name?: string): Promise<{ src: string; name: string; size: number } | null>
  timeZone: string
  note(what: string): void
}

const OPTION_COLOR: Record<string, OptionColor> = {
  default: 'gray',
  gray: 'gray',
  brown: 'brown',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  pink: 'pink',
  red: 'red'
}

const TYPES: Record<string, PropertyType> = {
  title: 'title',
  rich_text: 'text',
  number: 'number',
  select: 'select',
  multi_select: 'multi_select',
  status: 'status',
  date: 'date',
  people: 'person',
  files: 'files',
  checkbox: 'checkbox',
  url: 'url',
  email: 'email',
  phone_number: 'phone',
  formula: 'formula',
  relation: 'relation',
  rollup: 'rollup',
  created_time: 'created_time',
  created_by: 'created_by',
  last_edited_time: 'last_edited_time',
  last_edited_by: 'last_edited_by',
  unique_id: 'unique_id'
}

const ROLLUPS: Record<string, RollupAggregate> = {
  show_original: 'show_original',
  show_unique: 'show_original',
  count: 'count',
  count_all: 'count',
  count_values: 'count_values',
  unique: 'count_unique',
  count_unique_values: 'count_unique',
  empty: 'count_empty',
  count_empty: 'count_empty',
  not_empty: 'count_values',
  count_not_empty: 'count_values',
  percent_empty: 'percent_empty',
  percent_not_empty: 'percent_empty',
  sum: 'sum',
  average: 'average',
  median: 'median',
  min: 'min',
  max: 'max',
  range: 'range',
  earliest_date: 'earliest',
  latest_date: 'latest',
  date_range: 'range',
  checked: 'count_values',
  unchecked: 'count_empty',
  percent_checked: 'percent_checked',
  percent_unchecked: 'percent_checked',
  count_per_group: 'count',
  percent_per_group: 'count'
}

export const propertyId = (sourceId: string, schema: NotionPropertySchema): string =>
  schema.type === 'title' ? TITLE_PROPERTY_ID : stableId('property', sourceId, decode(schema.id))

const decode = (id: string): string => {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

const optionId = (
  sourceId: string,
  propId: string,
  option: { id?: string; name: string }
): string => stableId('option', sourceId, decode(propId), option.id ?? option.name)

function options(
  sourceId: string,
  prop: NotionPropertySchema,
  list: { id?: string; name: string; color?: string }[] | undefined
): SelectOption[] {
  return (list ?? []).map((o) => ({
    id: optionId(sourceId, prop.id, o),
    name: o.name,
    color: OPTION_COLOR[o.color ?? 'default'] ?? 'gray'
  }))
}

function statusGroup(name: string, index: number, count: number): StatusGroup {
  const n = name.toLowerCase()
  if (/complete|done|termin|fini|clos/.test(n)) return 'done'
  if (/progress|cours/.test(n)) return 'in_progress'
  if (/to-?do|faire|not started|pas commenc/.test(n)) return 'todo'
  return index === 0 ? 'todo' : index === count - 1 ? 'done' : 'in_progress'
}

/** The Notionix schema of a Notion data source (its views come from `views`). */
export function convertSchema(
  snapshot: DataSourceSnapshot,
  ctx: DatabaseContext,
  locked: boolean
): DatabaseSchema {
  const sourceId = snapshot.source.id
  const notion = snapshot.source.properties
  const props: PropertyDef[] = []
  const entries = Object.values(notion)
  // The title first, then the other properties in Notion's order.
  entries.sort((a, b) => (a.type === 'title' ? -1 : b.type === 'title' ? 1 : 0))
  for (const p of entries) {
    const type = TYPES[p.type]
    if (!type) {
      ctx.note(`Propriété « ${p.type} » non reprise`)
      continue
    }
    const def: PropertyDef = { id: propertyId(sourceId, p), name: p.name, type }
    const conf = (p[p.type] ?? {}) as Record<string, unknown>
    if (type === 'select' || type === 'multi_select')
      def.options = options(sourceId, p, conf.options as { name: string }[])
    if (type === 'status') {
      const groups = (conf.groups as { name: string; option_ids?: string[] }[] | undefined) ?? []
      def.options = options(sourceId, p, conf.options as { name: string }[]).map((o, i) => {
        const source = (conf.options as { id?: string }[])[i]
        const g = groups.findIndex((gr) => gr.option_ids?.includes(source?.id ?? ''))
        return { ...o, group: statusGroup(groups[g]?.name ?? '', Math.max(0, g), groups.length) }
      })
    }
    if (type === 'unique_id' && typeof conf.prefix === 'string' && conf.prefix)
      def.idPrefix = conf.prefix
    if (type === 'formula') def.formula = String(conf.expression ?? '')
    if (type === 'relation') {
      const target = String(conf.data_source_id ?? '')
      def.relationDatabaseId = target ? ctx.databaseOfSource(target) : null
      if (!def.relationDatabaseId) ctx.note('Relation vers une base non partagée')
      const dual = conf.dual_property as { synced_property_id?: string } | undefined
      if (dual?.synced_property_id && target) {
        const other = ctx.sourceSchema(target)
        const synced = other
          ? Object.values(other).find((s) => decode(s.id) === decode(dual.synced_property_id!))
          : undefined
        if (synced) def.syncedPropertyId = propertyId(target, synced)
      }
    }
    if (type === 'rollup') {
      const relation = Object.values(notion).find(
        (s) => decode(s.id) === decode(String(conf.relation_property_id ?? ''))
      )
      const target = relation
        ? String(
            (relation.relation as { data_source_id?: string } | undefined)?.data_source_id ?? ''
          )
        : ''
      const targetSchema = target ? ctx.sourceSchema(target) : null
      const rolled = targetSchema
        ? Object.values(targetSchema).find(
            (s) => decode(s.id) === decode(String(conf.rollup_property_id ?? ''))
          )
        : undefined
      def.rollup = {
        relationPropertyId: relation ? propertyId(sourceId, relation) : null,
        targetPropertyId: rolled && target ? propertyId(target, rolled) : null,
        aggregate: ROLLUPS[String(conf.function ?? 'show_original')] ?? 'show_original'
      }
    }
    props.push(def)
  }
  if (!props.some((p) => p.type === 'title'))
    props.unshift({ id: TITLE_PROPERTY_ID, name: 'Nom', type: 'title' })
  const schema: DatabaseSchema = { properties: props, views: [] }
  for (const view of snapshot.views) {
    const v = convertView(view, sourceId, notion, props, ctx)
    if (v) schema.views.push(v)
  }
  if (schema.views.length === 0) schema.views.push(defaultView('table', 'Tableau'))
  if (locked) schema.locked = true
  return schema
}

/** A row's values, by Notionix property id. */
export async function convertRow(
  row: NotionPage,
  snapshot: DataSourceSnapshot,
  schema: DatabaseSchema,
  ctx: DatabaseContext
): Promise<{ title: string; values: Record<string, PropertyValue> }> {
  const sourceId = snapshot.source.id
  const values: Record<string, PropertyValue> = {}
  let title = ''
  for (const value of Object.values(row.properties)) {
    const prop = Object.values(snapshot.source.properties).find(
      (s) => decode(s.id) === decode(value.id)
    )
    if (!prop) continue
    const id = propertyId(sourceId, prop)
    const def = schema.properties.find((p) => p.id === id)
    if (!def) continue
    const raw = value[value.type]
    switch (value.type) {
      case 'title':
        title = plainText(raw as never)
        break
      case 'rich_text': {
        const text = plainText(raw as never)
        if (text) values[id] = text
        break
      }
      case 'number':
        if (typeof raw === 'number') values[id] = raw
        break
      case 'checkbox':
        values[id] = raw === true
        break
      case 'url':
      case 'email':
      case 'phone_number':
        if (typeof raw === 'string' && raw) values[id] = raw
        break
      case 'select':
      case 'status': {
        const o = raw as { id?: string; name: string } | null
        if (o) values[id] = optionId(sourceId, prop.id, o)
        break
      }
      case 'multi_select': {
        const list = (raw as { id?: string; name: string }[] | null) ?? []
        if (list.length) values[id] = list.map((o) => optionId(sourceId, prop.id, o))
        break
      }
      case 'date': {
        const d = raw as { start: string; end?: string | null } | null
        if (d?.start) values[id] = notionDate(d, ctx.timeZone)
        break
      }
      case 'people': {
        const ids = ((raw as { id: string }[] | null) ?? [])
          .map((u) => ctx.userId(u.id))
          .filter((u): u is string => !!u)
        if (((raw as unknown[] | null) ?? []).length > ids.length)
          ctx.note('Personne sans compte Notionix (valeur de propriété)')
        if (ids.length) values[id] = ids
        break
      }
      case 'relation': {
        const ids = ((raw as { id: string }[] | null) ?? [])
          .map((r) => ctx.pageId(r.id))
          .filter((r): r is string => !!r)
        if (ids.length) values[id] = ids
        break
      }
      case 'files': {
        const out: string[] = []
        for (const f of (raw as NotionFile[] | null) ?? []) {
          const url = f.type === 'file' ? f.file.url : f.type === 'external' ? f.external.url : null
          if (!url) continue
          if (f.type === 'external') {
            out.push(fileValue(url, f.name ?? url))
            continue
          }
          const stored = await ctx.asset(url, f.name)
          if (stored) out.push(fileValue(stored.src, f.name ?? stored.name))
          else ctx.note('Fichier de propriété non récupéré')
        }
        if (out.length) values[id] = out
        break
      }
      case 'unique_id': {
        const n = (raw as { number?: number } | null)?.number
        if (typeof n === 'number' && n > 0) values[id] = n
        break
      }
      default:
        break
    }
  }
  return { title, values }
}

const VIEW_TYPES: Record<string, ViewType> = {
  table: 'table',
  board: 'board',
  list: 'list',
  gallery: 'gallery',
  calendar: 'calendar',
  timeline: 'timeline',
  chart: 'chart',
  form: 'form',
  map: 'table'
}

const RELATIVE: Record<string, string> = {
  today: '@today',
  tomorrow: '@tomorrow',
  yesterday: '@yesterday',
  this_week: '@this_week',
  past_week: '@past_7',
  next_week: '@next_7',
  past_month: '@past_30',
  next_month: '@next_30',
  this_month: '@this_month'
}

export function convertView(
  view: NotionView,
  sourceId: string,
  notion: Record<string, NotionPropertySchema>,
  props: PropertyDef[],
  ctx: DatabaseContext
): ViewDef | null {
  const type = VIEW_TYPES[view.type]
  if (!type) {
    ctx.note(`Vue « ${view.type} » non reprise`)
    return null
  }
  const find = (ref: unknown): PropertyDef | undefined => {
    if (typeof ref !== 'string') return undefined
    const schema =
      Object.values(notion).find((s) => decode(s.id) === decode(ref)) ??
      Object.values(notion).find((s) => s.name === ref)
    const id = schema ? propertyId(sourceId, schema) : null
    return id ? props.find((p) => p.id === id) : undefined
  }
  const out: ViewDef = { ...defaultView(type, view.name || 'Vue'), id: stableId('view', view.id) }
  const conf = (view.configuration ?? {}) as Record<string, unknown>
  const visible =
    (conf.properties as
      { property_id?: string; visible?: boolean; width?: number }[] | undefined) ?? []
  if (visible.length) {
    const shown = new Set<string>()
    const widths: Record<string, number> = {}
    for (const v of visible) {
      const p = find(v.property_id)
      if (!p) continue
      if (v.visible !== false) shown.add(p.id)
      if (typeof v.width === 'number' && v.width > 0) widths[p.id] = Math.round(v.width)
    }
    out.hidden = props.filter((p) => p.type !== 'title' && !shown.has(p.id)).map((p) => p.id)
    if (type === 'table' && Object.keys(widths).length) out.widths = widths
  }
  const groupOf = (g: unknown): string | null =>
    g && typeof g === 'object'
      ? (find((g as { property_id?: string }).property_id)?.id ?? null)
      : null
  const groupBy = groupOf(conf.group_by)
  if (groupBy) out.groupBy = groupBy
  const subGroupBy = groupOf(conf.sub_group_by)
  if (subGroupBy) out.subGroupBy = subGroupBy
  const date = find(conf.date_property_id)
  if (date) out.dateProperty = date.id
  if (conf.wrap_cells === true) out.wrap = true
  if (typeof conf.frozen_column_index === 'number' && conf.frozen_column_index > 0)
    out.freezeTitle = true
  if (type === 'board' && !out.groupBy) {
    const select = props.find((p) => p.type === 'status' || p.type === 'select')
    if (select) out.groupBy = select.id
  }
  if (type === 'chart') {
    const x = groupOf(conf.x_axis) ?? groupOf(conf.group_by) ?? out.groupBy ?? null
    out.chart = { type: 'bar', groupBy: x, aggregate: 'count', valueProperty: null }
  }
  // Sorts
  const sorts: Sort[] = []
  for (const s of (view.sorts ?? []) as {
    property?: string
    timestamp?: string
    direction?: string
  }[]) {
    const p = s.property ? find(s.property) : props.find((d) => d.type === s.timestamp)
    if (p)
      sorts.push({ propertyId: p.id, direction: s.direction === 'descending' ? 'desc' : 'asc' })
  }
  out.sorts = sorts
  // Filters: one level of « and » / « or », and groups inside it.
  if (view.filter && typeof view.filter === 'object') {
    const f = view.filter as Record<string, unknown>
    const top = Array.isArray(f.and) ? 'and' : Array.isArray(f.or) ? 'or' : null
    const items = top ? (f[top] as Record<string, unknown>[]) : [f]
    out.filterMode = top ?? 'and'
    const groups: FilterGroup[] = []
    for (const item of items) {
      const inner = Array.isArray(item.and) ? 'and' : Array.isArray(item.or) ? 'or' : null
      if (inner) {
        const filters = (item[inner] as Record<string, unknown>[])
          .map((c) => convertFilter(c, find))
          .filter((x): x is Filter => !!x)
        if (filters.length)
          groups.push({
            id: stableId('group', view.id, String(groups.length)),
            mode: inner,
            filters
          })
        continue
      }
      const one = convertFilter(item, find)
      if (one) out.filters.push(one)
      else ctx.note('Filtre de vue non repris')
    }
    if (groups.length) out.filterGroups = groups
  }
  return out
}

const OPERATORS: Record<string, FilterOperator> = {
  equals: 'equals',
  does_not_equal: 'not_equals',
  contains: 'contains',
  does_not_contain: 'not_contains',
  is_empty: 'is_empty',
  is_not_empty: 'is_not_empty',
  greater_than: 'gt',
  less_than: 'lt',
  greater_than_or_equal_to: 'gte',
  less_than_or_equal_to: 'lte',
  before: 'before',
  after: 'after',
  on_or_before: 'before',
  on_or_after: 'after',
  starts_with: 'contains',
  ends_with: 'contains'
}

function convertFilter(
  item: Record<string, unknown>,
  find: (ref: unknown) => PropertyDef | undefined
): Filter | null {
  const prop = typeof item.property === 'string' ? find(item.property) : undefined
  if (!prop) return null
  const condition = Object.entries(item).find(([k]) => k !== 'property' && k !== 'type')?.[1] as
    Record<string, unknown> | undefined
  if (!condition || typeof condition !== 'object') return null
  const [op, value] = Object.entries(condition)[0] ?? []
  if (!op) return null
  const id = stableId('filter', prop.id, op, JSON.stringify(value ?? null))
  if (prop.type === 'checkbox' && op === 'equals')
    return { id, propertyId: prop.id, operator: value === true ? 'is_checked' : 'is_not_checked' }
  if (RELATIVE[op]) return { id, propertyId: prop.id, operator: 'equals', value: RELATIVE[op] }
  const operator = OPERATORS[op]
  if (!operator) return null
  if (operator === 'is_empty' || operator === 'is_not_empty')
    return { id, propertyId: prop.id, operator }
  let v: string | number | null =
    typeof value === 'number' || typeof value === 'string' ? value : null
  if (
    (prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status') &&
    typeof v === 'string'
  ) {
    const option = prop.options?.find((o) => o.name === v)
    v = option ? option.id : v
  }
  if (prop.type === 'date' && typeof v === 'string') v = v.slice(0, 10)
  return { id, propertyId: prop.id, operator, value: v }
}
