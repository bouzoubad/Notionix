import { useState } from 'react'
import {
  OPTION_COLORS,
  PROPERTY_TYPE_LABELS,
  STATUS_GROUP_LABELS,
  newId,
  type StatusGroup,
  TITLE_PROPERTY_ID,
  type DatabaseSchema,
  type OptionColor,
  type PropertyDef,
  type PropertyType,
  type ViewDef
} from '../../../shared/database'
import { useStore } from '../store'
import { Popover } from './Popover'
import { FormulaEditor, RollupEditor } from './ComputedEditors'
import { t } from '../../../shared/i18n'

const CHANGEABLE_TYPES = (Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).filter(
  (type) => type !== 'title'
)

const COLOR_LABELS: Record<OptionColor, string> = {
  gray: t('Gris'),
  brown: t('Marron'),
  orange: t('Orange'),
  yellow: t('Jaune'),
  green: t('Vert'),
  blue: t('Bleu'),
  purple: t('Violet'),
  pink: t('Rose'),
  red: t('Rouge')
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
        aria-label={t('Nom de la propriété')}
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
          {t('Type')}
          <select value={prop.type} onChange={(e) => onChangeType(e.target.value as PropertyType)}>
            {CHANGEABLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {PROPERTY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      )}
      {prop.type === 'formula' && (
        <FormulaEditor prop={prop} schema={schema} onSave={(formula) => patchProp({ formula })} />
      )}
      {prop.type === 'rollup' && (
        <RollupEditor prop={prop} schema={schema} onChange={(rollup) => patchProp({ rollup })} />
      )}
      {prop.type === 'unique_id' && (
        <label className="menu-row">
          {t('Préfixe')}
          <input
            aria-label={t('Préfixe')}
            placeholder={t('ex. TÂCHE')}
            defaultValue={prop.idPrefix ?? ''}
            onBlur={(e) =>
              e.target.value !== (prop.idPrefix ?? '') &&
              patchProp({ idPrefix: e.target.value.trim() })
            }
          />
        </label>
      )}
      {prop.type === 'relation' && prop.relationDatabaseId && (
        <label className="menu-row">
          <input
            type="checkbox"
            checked={!!prop.syncedPropertyId}
            disabled={!!prop.syncedPropertyId}
            onChange={() => {
              void window.api.databases
                .linkRelation(databaseId, prop.id)
                .then(() => useStore.getState().remoteChange())
              onClose()
            }}
          />
          {t('Relation à double sens (visible dans la base liée)')}
        </label>
      )}
      {prop.type === 'relation' && (
        <label className="menu-row">
          {t('Base liée')}
          <select
            value={prop.relationDatabaseId ?? ''}
            onChange={(e) => patchProp({ relationDatabaseId: e.target.value || null })}
          >
            <option value="">{t('Choisir…')}</option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id === databaseId ? t('Cette base') : d.title || t('Sans titre')}
              </option>
            ))}
          </select>
        </label>
      )}
      {(prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status') && (
        <div className="options-editor">
          <div className="menu-label">{t('Options')}</div>
          {options.map((o) => (
            <div key={o.id} className="option-row">
              <select
                aria-label={t('Couleur de {name}', { name: o.name })}
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
              {prop.type === 'status' && (
                <select
                  aria-label={t('Étape de {name}', { name: o.name })}
                  value={o.group ?? 'todo'}
                  onChange={(e) =>
                    patchProp({
                      options: options.map((x) =>
                        x.id === o.id ? { ...x, group: e.target.value as StatusGroup } : x
                      )
                    })
                  }
                >
                  {Object.entries(STATUS_GROUP_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              <input
                aria-label={t('Nom de l’option')}
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
                title={t('Supprimer l’option')}
                onClick={() => patchProp({ options: options.filter((x) => x.id !== o.id) })}
              >
                ×
              </button>
            </div>
          ))}
          {prop.type === 'status' && (
            <button
              className="menu-item"
              onClick={() =>
                patchProp({
                  options: [
                    ...options,
                    { id: newId(), name: t('Nouvelle étape'), color: 'gray', group: 'in_progress' }
                  ]
                })
              }
            >
              {t('+ Ajouter une option')}
            </button>
          )}
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
        {t('Trier par ordre croissant')}
      </button>
      <button
        className="menu-item"
        onClick={() => (
          patchView({ sorts: [{ propertyId: prop.id, direction: 'desc' }] }),
          onClose()
        )}
      >
        {t('Trier par ordre décroissant')}
      </button>
      {prop.id !== TITLE_PROPERTY_ID && (
        <>
          <button
            className="menu-item"
            onClick={() => (patchView({ hidden: [...view.hidden, prop.id] }), onClose())}
          >
            {t('Masquer dans cette vue')}
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              if (
                !confirm(
                  t('Supprimer la propriété « {name} » et ses valeurs ?', { name: prop.name })
                )
              )
                return
              onSchema({ ...schema, properties: schema.properties.filter((p) => p.id !== prop.id) })
              onClose()
            }}
          >
            {t('Supprimer la propriété')}
          </button>
        </>
      )}
    </Popover>
  )
}
