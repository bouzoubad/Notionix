import {
  READ_ONLY_TYPES,
  TITLE_PROPERTY_ID,
  isComputed,
  normalizeValue,
  type PropertyDef,
  type PropertyValue,
  type SelectOption
} from '../../src/shared/database'
import type { Workspace } from './workspace'

/** Types a public form can ask for: no people, pages or files of the workspace. */
const PUBLIC_TYPES = new Set([
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone'
])

export interface PublicFormField {
  id: string
  name: string
  type: PropertyDef['type']
  options?: SelectOption[]
}

export interface PublicForm {
  title: string
  fields: PublicFormField[]
}

/** Answers per address and minute, so that a public form cannot be flooded. */
const MAX_PER_MINUTE = 10

/**
 * Forms shared with a public link: anyone may add a row to the database,
 * through the fields of the form view only.
 */
export class PublicForms {
  private readonly recent = new Map<string, number[]>()

  constructor(
    private readonly ws: Workspace,
    private readonly now: () => number = Date.now
  ) {}

  private find(token: string): { databaseId: string; fields: PropertyDef[]; title: string } | null {
    if (!/^[a-z0-9]{16,64}$/.test(token)) return null
    for (const page of this.ws.pages.list()) {
      if (page.kind !== 'database' || page.trashedAt) continue
      const schema = this.ws.databases.schemaOf(page.id)
      const view = schema?.views.find((v) => v.type === 'form' && v.formToken === token)
      if (!schema || !view) continue
      const fields = schema.properties.filter(
        (p) =>
          (p.id === TITLE_PROPERTY_ID || !view.hidden.includes(p.id)) &&
          PUBLIC_TYPES.has(p.type) &&
          !isComputed(p.type) &&
          !READ_ONLY_TYPES.has(p.type)
      )
      return { databaseId: page.id, fields, title: view.name || page.title || 'Formulaire' }
    }
    return null
  }

  form(token: string): PublicForm | null {
    const found = this.find(token)
    if (!found) return null
    return {
      title: found.title,
      fields: found.fields.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        ...(p.options ? { options: p.options } : {})
      }))
    }
  }

  /** Adds the answer as a row; false when the link is unknown or too many answers came from `from`. */
  answer(token: string, input: Record<string, unknown>, from: string): 'ok' | 'unknown' | 'busy' {
    const found = this.find(token)
    if (!found) return 'unknown'
    const t = this.now()
    const times = (this.recent.get(from) ?? []).filter((x) => t - x < 60_000)
    if (times.length >= MAX_PER_MINUTE) return 'busy'
    this.recent.set(from, [...times, t])
    const values: Record<string, PropertyValue> = {}
    let title = ''
    for (const field of found.fields) {
      const raw = input[field.id]
      if (field.id === TITLE_PROPERTY_ID) title = typeof raw === 'string' ? raw.slice(0, 2000) : ''
      else {
        const v = normalizeValue(field, raw)
        if (v !== null) values[field.id] = v
      }
    }
    this.ws.pages.as(null, () =>
      this.ws.databases.createRow(found.databaseId, { title, properties: values })
    )
    return 'ok'
  }
}
