import {
  TITLE_PROPERTY_ID,
  type DatabaseRow,
  type DatabaseSchema,
  type PropertyDef,
  type PropertyType,
  type PropertyValue,
  type SelectOption,
  type ViewDef
} from '../../../shared/database'

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
  rollup: 'Σ'
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
}

/** Rows keep the manual order only when the view has no sort. */
export const canReorder = (view: ViewDef): boolean => view.sorts.length === 0

/** Property a table or list view is grouped by (select or checkbox), if any. */
export const groupProperty = (schema: DatabaseSchema, view: ViewDef): PropertyDef | undefined =>
  schema.properties.find(
    (p) => p.id === view.groupBy && (p.type === 'select' || p.type === 'checkbox')
  )

export const visibleProperties = (schema: DatabaseSchema, view: ViewDef): PropertyDef[] => [
  schema.properties.find((p) => p.id === TITLE_PROPERTY_ID)!,
  ...schema.properties.filter((p) => p.id !== TITLE_PROPERTY_ID && !view.hidden.includes(p.id))
]
