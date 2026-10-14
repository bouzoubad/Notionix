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
  last_edited_time: '🕒'
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
}

export const visibleProperties = (schema: DatabaseSchema, view: ViewDef): PropertyDef[] => [
  schema.properties.find((p) => p.id === TITLE_PROPERTY_ID)!,
  ...schema.properties.filter((p) => p.id !== TITLE_PROPERTY_ID && !view.hidden.includes(p.id))
]
