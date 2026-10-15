import {
  TITLE_PROPERTY_ID,
  type DatabaseRow,
  type DatabaseSchema,
  type PropertyDef,
  type PropertyType,
  type PropertyValue,
  type SelectOption,
  type ViewDef,
  GROUPABLE_TYPES,
  READ_ONLY_TYPES,
  isComputed,
  type RowGroup
} from '../../../shared/database'
import { useStore } from '../store'

export const TYPE_ICONS: Record<PropertyType, string> = {
  title: 'Aa',
  text: '≡',
  number: '#',
  select: '◉',
  multi_select: '☰',
  date: '📅',
  checkbox: '☑',
  url: '🔗',
  email: '@',
  phone: '☎',
  relation: '↗',
  created_time: '🕒',
  last_edited_time: '🕒',
  formula: 'ƒ',
  rollup: 'Σ',
  person: '👤',
  files: '📎',
  status: '◐',
  created_by: '👤',
  last_edited_by: '👤',
  unique_id: '№'
}

export interface ViewProps {
  databaseId: string
  schema: DatabaseSchema
  view: ViewDef
  rows: DatabaseRow[]
  onSchema: (schema: DatabaseSchema) => void
  onChangeType: (propertyId: string, type: PropertyType) => void
  onUpdateRow: (rowId: string, values: Record<string, PropertyValue>) => void
  onAddRow: (values?: Record<string, PropertyValue>) => void
  onOpenRow: (rowId: string) => void
  onCreateOption: (prop: PropertyDef, option: SelectOption) => Promise<void>
  /** Places a row before another one (null: last), optionally changing its group values */
  onMoveRow: (
    rowId: string,
    beforeRowId: string | null,
    values?: Record<string, PropertyValue>
  ) => void
  /** Views and properties locked: their settings cannot be changed */
  locked?: boolean
}

/** Rows keep the manual order only when the view has no sort. */
export const canReorder = (view: ViewDef): boolean => view.sorts.length === 0

/** Property a view is grouped by, if any. */
export const groupProperty = (schema: DatabaseSchema, view: ViewDef): PropertyDef | undefined =>
  schema.properties.find((p) => p.id === view.groupBy && GROUPABLE_TYPES.includes(p.type))

/** Property of the second grouping (table and list), if any. */
export const subGroupProperty = (schema: DatabaseSchema, view: ViewDef): PropertyDef | undefined =>
  schema.properties.find(
    (p) => p.id === view.subGroupBy && p.id !== view.groupBy && GROUPABLE_TYPES.includes(p.type)
  )

/**
 * Values a row takes when moved into a group; none for groups it cannot
 * change (dates of creation, authors, months of a date without a value).
 */
export function groupValues(
  prop: PropertyDef | undefined,
  group: RowGroup
): Record<string, PropertyValue> | undefined {
  if (!prop || READ_ONLY_TYPES.has(prop.type) || isComputed(prop.type)) return undefined
  if (group.value === null && group.key !== null) return undefined
  return { [prop.id]: group.value }
}

/** Name of a page or a person, for relation, person and "created by" values. */
export const nameOf = (id: string): string | undefined => {
  const { pages, people } = useStore.getState()
  const page = pages.find((p) => p.id === id && !p.trashedAt)
  if (page) return page.title || 'Sans titre'
  return people.find((p) => p.id === id)?.name
}

export const visibleProperties = (schema: DatabaseSchema, view: ViewDef): PropertyDef[] => [
  schema.properties.find((p) => p.id === TITLE_PROPERTY_ID)!,
  ...schema.properties.filter((p) => p.id !== TITLE_PROPERTY_ID && !view.hidden.includes(p.id))
]
