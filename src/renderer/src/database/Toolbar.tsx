import { useState } from 'react'
import {
  TITLE_PROPERTY_ID,
  newId,
  operatorsFor,
  type DatabaseRow,
  type DatabaseSchema,
  type Filter,
  type PropertyDef,
  type ViewDef
} from '../../../shared/database'
import { Popover } from './Popover'

/** Filters, sorts, visible properties and the "new row" button of a view. */
export function Toolbar({
  schema,
  view,
  templates,
  onSchema,
  onNewRow
}: {
  schema: DatabaseSchema
  view: ViewDef
  templates: DatabaseRow[]
  onSchema: (schema: DatabaseSchema) => void
  onNewRow: (templateId?: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<'filter' | 'sort' | 'props' | 'new' | null>(null)
  const close = (): void => setOpen(null)
  const patchView = (next: Partial<ViewDef>): void =>
    onSchema({
      ...schema,
      views: schema.views.map((v) => (v.id === view.id ? { ...v, ...next } : v))
    })
  const propOf = (id: string): PropertyDef | undefined => schema.properties.find((p) => p.id === id)
  const setFilter = (id: string, next: Partial<Filter>): void =>
    patchView({ filters: view.filters.map((f) => (f.id === id ? { ...f, ...next } : f)) })

  return (
    <div className="db-toolbar">
      <span className="toolbar-anchor">
        <button className={view.filters.length ? 'active' : ''} onClick={() => setOpen('filter')}>
          Filtrer{view.filters.length ? ` (${view.filters.length})` : ''}
        </button>
        {open === 'filter' && (
          <Popover onClose={close} align="right" className="filter-popover">
            {view.filters.length > 1 && (
              <label className="menu-row">
                Lignes qui respectent
                <select
                  value={view.filterMode}
                  onChange={(e) => patchView({ filterMode: e.target.value as 'and' | 'or' })}
                >
                  <option value="and">tous les filtres</option>
                  <option value="or">au moins un filtre</option>
                </select>
              </label>
            )}
            {view.filters.map((f) => {
              const prop = propOf(f.propertyId)
              if (!prop) return null
              return (
                <div key={f.id} className="filter-row">
                  <select
                    aria-label="Propriété"
                    value={f.propertyId}
                    onChange={(e) => {
                      const next = propOf(e.target.value)!
                      setFilter(f.id, {
                        propertyId: next.id,
                        operator: operatorsFor(next.type)[0].op,
                        value: null
                      })
                    }}
                  >
                    {schema.properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Condition"
                    value={f.operator}
                    onChange={(e) =>
                      setFilter(f.id, { operator: e.target.value as Filter['operator'] })
                    }
                  >
                    {operatorsFor(prop.type).map((o) => (
                      <option key={o.op} value={o.op}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <FilterValue
                    prop={prop}
                    filter={f}
                    onValue={(value) => setFilter(f.id, { value })}
                  />
                  <button
                    title="Retirer le filtre"
                    onClick={() =>
                      patchView({ filters: view.filters.filter((x) => x.id !== f.id) })
                    }
                  >
                    ×
                  </button>
                </div>
              )
            })}
            <button
              className="menu-item"
              onClick={() =>
                patchView({
                  filters: [
                    ...view.filters,
                    {
                      id: newId(),
                      propertyId: TITLE_PROPERTY_ID,
                      operator: 'contains',
                      value: null
                    }
                  ]
                })
              }
            >
              + Ajouter un filtre
            </button>
          </Popover>
        )}
      </span>
      <span className="toolbar-anchor">
        <button className={view.sorts.length ? 'active' : ''} onClick={() => setOpen('sort')}>
          Trier{view.sorts.length ? ` (${view.sorts.length})` : ''}
        </button>
        {open === 'sort' && (
          <Popover onClose={close} align="right">
            {view.sorts.map((s, i) => (
              <div key={`${s.propertyId}-${i}`} className="filter-row">
                <select
                  aria-label="Propriété"
                  value={s.propertyId}
                  onChange={(e) =>
                    patchView({
                      sorts: view.sorts.map((x, j) =>
                        j === i ? { ...x, propertyId: e.target.value } : x
                      )
                    })
                  }
                >
                  {schema.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Ordre"
                  value={s.direction}
                  onChange={(e) =>
                    patchView({
                      sorts: view.sorts.map((x, j) =>
                        j === i ? { ...x, direction: e.target.value as 'asc' | 'desc' } : x
                      )
                    })
                  }
                >
                  <option value="asc">Croissant</option>
                  <option value="desc">Décroissant</option>
                </select>
                <button
                  title="Retirer le tri"
                  onClick={() => patchView({ sorts: view.sorts.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="menu-item"
              onClick={() =>
                patchView({
                  sorts: [...view.sorts, { propertyId: TITLE_PROPERTY_ID, direction: 'asc' }]
                })
              }
            >
              + Ajouter un tri
            </button>
          </Popover>
        )}
      </span>
      <span className="toolbar-anchor">
        <button onClick={() => setOpen('props')}>Propriétés</button>
        {open === 'props' && (
          <Popover onClose={close} align="right">
            {schema.properties
              .filter((p) => p.id !== TITLE_PROPERTY_ID)
              .map((p) => (
                <label key={p.id} className="menu-row check-row">
                  <input
                    type="checkbox"
                    checked={!view.hidden.includes(p.id)}
                    onChange={(e) =>
                      patchView({
                        hidden: e.target.checked
                          ? view.hidden.filter((h) => h !== p.id)
                          : [...view.hidden, p.id]
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
            {schema.properties.length === 1 && <p className="hint">Aucune autre propriété.</p>}
          </Popover>
        )}
      </span>
      <span className="toolbar-anchor new-row">
        <button className="primary" onClick={() => onNewRow()}>
          Nouveau
        </button>
        <button
          className="primary split"
          aria-label="Choisir un modèle"
          onClick={() => setOpen('new')}
        >
          ▾
        </button>
        {open === 'new' && (
          <Popover onClose={close} align="right">
            <div className="menu-label">Modèles</div>
            {templates.map((t) => (
              <button key={t.id} className="menu-item" onClick={() => (close(), onNewRow(t.id))}>
                {t.icon ?? '📄'} {t.title || 'Sans titre'}
              </button>
            ))}
            {templates.length === 0 && (
              <p className="hint">
                Aucun modèle. Ouvrez une ligne et cochez « Modèle » pour en créer un.
              </p>
            )}
          </Popover>
        )}
      </span>
    </div>
  )
}

function FilterValue({
  prop,
  filter,
  onValue
}: {
  prop: PropertyDef
  filter: Filter
  onValue: (value: string | number | null) => void
}): React.JSX.Element | null {
  if (['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'].includes(filter.operator))
    return null
  if (prop.type === 'select' || prop.type === 'multi_select') {
    return (
      <select
        aria-label="Valeur"
        value={String(filter.value ?? '')}
        onChange={(e) => onValue(e.target.value || null)}
      >
        <option value="">Choisir…</option>
        {(prop.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  const isDate = ['date', 'created_time', 'last_edited_time'].includes(prop.type)
  return (
    <input
      aria-label="Valeur"
      type={isDate ? 'date' : prop.type === 'number' ? 'number' : 'text'}
      value={filter.value ?? ''}
      onChange={(e) =>
        onValue(
          e.target.value === ''
            ? null
            : prop.type === 'number'
              ? Number(e.target.value)
              : e.target.value
        )
      }
    />
  )
}
