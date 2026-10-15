import { useState } from 'react'
import { PageIcon } from '../components/PageIcon'
import {
  TITLE_PROPERTY_ID,
  newId,
  operatorsFor,
  type DatabaseRow,
  type DatabaseSchema,
  type Filter,
  type FilterGroup,
  RELATIVE_DATES,
  type PropertyDef,
  type ViewDef
} from '../../../shared/database'
import { Popover } from './Popover'
import { useStore } from '../store'

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
  const groups = view.filterGroups ?? []
  const setGroup = (id: string, next: Partial<FilterGroup>): void =>
    patchView({ filterGroups: groups.map((g) => (g.id === id ? { ...g, ...next } : g)) })

  return (
    <div className="db-toolbar">
      <span className="toolbar-anchor">
        <button
          className={view.filters.length + groups.length ? 'active' : ''}
          onClick={() => setOpen('filter')}
        >
          Filtrer
          {view.filters.length + groups.length ? ` (${view.filters.length + groups.length})` : ''}
        </button>
        {open === 'filter' && (
          <Popover onClose={close} align="right" className="filter-popover">
            {view.filters.length + groups.length > 1 && (
              <label className="menu-row">
                Lignes qui respectent
                <select
                  value={view.filterMode}
                  onChange={(e) => patchView({ filterMode: e.target.value as 'and' | 'or' })}
                >
                  <option value="and">toutes les conditions</option>
                  <option value="or">au moins une condition</option>
                </select>
              </label>
            )}
            {view.filters.map((f) => (
              <FilterRow
                key={f.id}
                schema={schema}
                filter={f}
                onChange={(next) =>
                  patchView({
                    filters: view.filters.map((x) => (x.id === f.id ? { ...x, ...next } : x))
                  })
                }
                onRemove={() => patchView({ filters: view.filters.filter((x) => x.id !== f.id) })}
              />
            ))}
            {groups.map((g) => (
              <div key={g.id} className="filter-group">
                <div className="filter-group-head">
                  <select
                    aria-label="Groupe"
                    value={g.mode}
                    onChange={(e) => setGroup(g.id, { mode: e.target.value as 'and' | 'or' })}
                  >
                    <option value="and">Groupe : toutes ces conditions</option>
                    <option value="or">Groupe : au moins une de ces conditions</option>
                  </select>
                  <button
                    title="Retirer le groupe"
                    onClick={() => patchView({ filterGroups: groups.filter((x) => x.id !== g.id) })}
                  >
                    ×
                  </button>
                </div>
                {g.filters.map((f) => (
                  <FilterRow
                    key={f.id}
                    schema={schema}
                    filter={f}
                    onChange={(next) =>
                      setGroup(g.id, {
                        filters: g.filters.map((x) => (x.id === f.id ? { ...x, ...next } : x))
                      })
                    }
                    onRemove={() =>
                      setGroup(g.id, { filters: g.filters.filter((x) => x.id !== f.id) })
                    }
                  />
                ))}
                <button
                  className="menu-item"
                  onClick={() => setGroup(g.id, { filters: [...g.filters, blankFilter()] })}
                >
                  + Condition dans le groupe
                </button>
              </div>
            ))}
            <button
              className="menu-item"
              onClick={() => patchView({ filters: [...view.filters, blankFilter()] })}
            >
              + Ajouter un filtre
            </button>
            <button
              className="menu-item"
              onClick={() =>
                patchView({
                  filterGroups: [
                    ...groups,
                    { id: newId(), mode: 'or', filters: [blankFilter(), blankFilter()] }
                  ]
                })
              }
            >
              + Ajouter un groupe de filtres
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
                <PageIcon icon={t.icon} fallback="📄" /> {t.title || 'Sans titre'}
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

const blankFilter = (): Filter => ({
  id: newId(),
  propertyId: TITLE_PROPERTY_ID,
  operator: 'contains',
  value: null
})

/** One condition: property, operator, value. */
function FilterRow({
  schema,
  filter,
  onChange,
  onRemove
}: {
  schema: DatabaseSchema
  filter: Filter
  onChange: (next: Partial<Filter>) => void
  onRemove: () => void
}): React.JSX.Element | null {
  const prop = schema.properties.find((p) => p.id === filter.propertyId)
  if (!prop) return null
  return (
    <div className="filter-row">
      <select
        aria-label="Propriété"
        value={filter.propertyId}
        onChange={(e) => {
          const next = schema.properties.find((p) => p.id === e.target.value)!
          onChange({ propertyId: next.id, operator: operatorsFor(next.type)[0].op, value: null })
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
        value={filter.operator}
        onChange={(e) => onChange({ operator: e.target.value as Filter['operator'] })}
      >
        {operatorsFor(prop.type).map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      <FilterValue prop={prop} filter={filter} onValue={(value) => onChange({ value })} />
      <button title="Retirer le filtre" onClick={onRemove}>
        ×
      </button>
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
  if (['person', 'created_by', 'last_edited_by'].includes(prop.type)) {
    return (
      <select
        aria-label="Valeur"
        value={String(filter.value ?? '')}
        onChange={(e) => onValue(e.target.value || null)}
      >
        <option value="">Choisir…</option>
        {useStore.getState().people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    )
  }
  if (prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status') {
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
  if (isDate) {
    // A relative date (this week…) or an exact one.
    const relative = typeof filter.value === 'string' && filter.value.startsWith('@')
    return (
      <span className="filter-date">
        <select
          aria-label="Date"
          value={relative ? String(filter.value) : 'exact'}
          onChange={(e) => onValue(e.target.value === 'exact' ? null : e.target.value)}
        >
          <option value="exact">Date précise</option>
          {Object.entries(RELATIVE_DATES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {!relative && (
          <input
            aria-label="Valeur"
            type="date"
            value={filter.value ?? ''}
            onChange={(e) => onValue(e.target.value || null)}
          />
        )}
      </span>
    )
  }
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
