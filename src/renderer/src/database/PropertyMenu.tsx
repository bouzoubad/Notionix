import { useState } from 'react'
import {
  OPTION_COLORS,
  PROPERTY_TYPE_LABELS,
  TITLE_PROPERTY_ID,
  type DatabaseSchema,
  type OptionColor,
  type PropertyDef,
  type PropertyType,
  type ViewDef
} from '../../../shared/database'
import { useStore } from '../store'
import { Popover } from './Popover'

const CHANGEABLE_TYPES = (Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).filter(
  (t) => t !== 'title'
)

const COLOR_LABELS: Record<OptionColor, string> = {
  gray: 'Gris',
  brown: 'Marron',
  orange: 'Orange',
  yellow: 'Jaune',
  green: 'Vert',
  blue: 'Bleu',
  purple: 'Violet',
  pink: 'Rose',
  red: 'Rouge'
}

/** Property settings: name, type, select options, relation target, hide, sort, delete. */
export function PropertyMenu({
  prop,
  schema,
  view,
  databaseId,
  onSchema,
  onChangeType,
  onClose
}: {
  prop: PropertyDef
  schema: DatabaseSchema
  view: ViewDef
  databaseId: string
  onSchema: (schema: DatabaseSchema) => void
  onChangeType: (type: PropertyType) => void
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState(prop.name)
  const pages = useStore((s) => s.pages)
  const databases = pages.filter((p) => p.kind === 'database' && !p.trashedAt)
  const patchProp = (next: Partial<PropertyDef>): void =>
    onSchema({
      ...schema,
      properties: schema.properties.map((p) => (p.id === prop.id ? { ...p, ...next } : p))
    })
  const patchView = (next: Partial<ViewDef>): void =>
    onSchema({
      ...schema,
      views: schema.views.map((v) => (v.id === view.id ? { ...v, ...next } : v))
    })
  const commitName = (): void => {
    if (name.trim() && name !== prop.name) patchProp({ name: name.trim() })
  }
  const options = prop.options ?? []

  return (
    <Popover onClose={() => (commitName(), onClose())} className="property-menu">
      <input
        autoFocus
        aria-label="Nom de la propriété"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitName()
            onClose()
          }
        }}
      />
      {prop.id !== TITLE_PROPERTY_ID && (
        <label className="menu-row">
          Type
          <select value={prop.type} onChange={(e) => onChangeType(e.target.value as PropertyType)}>
            {CHANGEABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      )}
      {prop.type === 'relation' && (
        <label className="menu-row">
          Base liée
          <select
            value={prop.relationDatabaseId ?? ''}
            onChange={(e) => patchProp({ relationDatabaseId: e.target.value || null })}
          >
            <option value="">Choisir…</option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id === databaseId ? 'Cette base' : d.title || 'Sans titre'}
              </option>
            ))}
          </select>
        </label>
      )}
      {(prop.type === 'select' || prop.type === 'multi_select') && (
        <div className="options-editor">
          <div className="menu-label">Options</div>
          {options.map((o) => (
            <div key={o.id} className="option-row">
              <select
                aria-label={`Couleur de ${o.name}`}
                className={`color-dot tag-${o.color}`}
                value={o.color}
                onChange={(e) =>
                  patchProp({
                    options: options.map((x) =>
                      x.id === o.id ? { ...x, color: e.target.value as OptionColor } : x
                    )
                  })
                }
              >
                {OPTION_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {COLOR_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Nom de l’option"
                defaultValue={o.name}
                onBlur={(e) =>
                  e.target.value !== o.name &&
                  patchProp({
                    options: options.map((x) =>
                      x.id === o.id ? { ...x, name: e.target.value } : x
                    )
                  })
                }
              />
              <button
                title="Supprimer l’option"
                onClick={() => patchProp({ options: options.filter((x) => x.id !== o.id) })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="menu-sep" />
      <button
        className="menu-item"
        onClick={() => (
          patchView({ sorts: [{ propertyId: prop.id, direction: 'asc' }] }),
          onClose()
        )}
      >
        Trier par ordre croissant
      </button>
      <button
        className="menu-item"
        onClick={() => (
          patchView({ sorts: [{ propertyId: prop.id, direction: 'desc' }] }),
          onClose()
        )}
      >
        Trier par ordre décroissant
      </button>
      {prop.id !== TITLE_PROPERTY_ID && (
        <>
          <button
            className="menu-item"
            onClick={() => (patchView({ hidden: [...view.hidden, prop.id] }), onClose())}
          >
            Masquer dans cette vue
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              if (!confirm(`Supprimer la propriété « ${prop.name} » et ses valeurs ?`)) return
              onSchema({ ...schema, properties: schema.properties.filter((p) => p.id !== prop.id) })
              onClose()
            }}
          >
            Supprimer la propriété
          </button>
        </>
      )}
    </Popover>
  )
}
