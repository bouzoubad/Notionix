import { useState } from 'react'
import { PageIcon } from '../components/PageIcon'
import { RecurrenceEditor } from './RecurrenceEditor'
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
import { t } from '../../../shared/i18n'

/** Filters, sorts, visible properties and the "new row" button of a view. */
export function Toolbar({
  schema,
  view,
  templates,
  onSchema,
  onNewRow,
  locked = false,
  databaseId
}: {
  databaseId: string
  schema: DatabaseSchema
  view: ViewDef
  locked?: boolean
  templates: DatabaseRow[]
  onSchema: (schema: DatabaseSchema) => void
  onNewRow: (templateId?: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<'filter' | 'sort' | 'props' | 'new' | null>(null)
  const [repeating, setRepeating] = useState<DatabaseRow | null>(null)
  const close = (): void => (setOpen(null), setRepeating(null))
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
          disabled={locked}
          title={locked ? t('Base verrouillée') : undefined}
          onClick={() => setOpen('filter')}
        >
          {t('Filtrer')}
          {view.filters.length + groups.length ? ` (${view.filters.length + groups.length})` : ''}
        </button>
        {open === 'filter' && (
          <Popover onClose={close} align="right" className="filter-popover">
            {view.filters.length + groups.length > 1 && (
              <label className="menu-row">
                {t('Lignes qui respectent')}
                <select
                  value={view.filterMode}
                  onChange={(e) => patchView({ filterMode: e.target.value as 'and' | 'or' })}
                >
                  <option value="and">{t('toutes les conditions')}</option>
                  <option value="or">{t('au moins une condition')}</option>
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
                    aria-label={t('Groupe')}
                    value={g.mode}
                    onChange={(e) => setGroup(g.id, { mode: e.target.value as 'and' | 'or' })}
                  >
                    <option value="and">{t('Groupe : toutes ces conditions')}</option>
                    <option value="or">{t('Groupe : au moins une de ces conditions')}</option>
                  </select>
                  <button
                    title={t('Retirer le groupe')}
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
                  {t('+ Condition dans le groupe')}
                </button>
              </div>
            ))}
            <button
              className="menu-item"
              onClick={() => patchView({ filters: [...view.filters, blankFilter()] })}
            >
              {t('+ Ajouter un filtre')}
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
              {t('+ Ajouter un groupe de filtres')}
            </button>
          </Popover>
        )}
      </span>
      <span className="toolbar-anchor">
        <button
          className={view.sorts.length ? 'active' : ''}
          disabled={locked}
          title={locked ? t('Base verrouillée') : undefined}
          onClick={() => setOpen('sort')}
        >
          {t('Trier')}
          {view.sorts.length ? ` (${view.sorts.length})` : ''}
        </button>
        {open === 'sort' && (
          <Popover onClose={close} align="right">
            {view.sorts.map((s, i) => (
              <div key={`${s.propertyId}-${i}`} className="filter-row">
                <select
                  aria-label={t('Propriété')}
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
                  aria-label={t('Ordre')}
                  value={s.direction}
                  onChange={(e) =>
                    patchView({
                      sorts: view.sorts.map((x, j) =>
                        j === i ? { ...x, direction: e.target.value as 'asc' | 'desc' } : x
                      )
                    })
                  }
                >
                  <option value="asc">{t('Croissant')}</option>
                  <option value="desc">{t('Décroissant')}</option>
                </select>
                <button
                  title={t('Retirer le tri')}
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
              {t('+ Ajouter un tri')}
            </button>
          </Popover>
        )}
      </span>
      <span className="toolbar-anchor">
        <button
          disabled={locked}
          title={locked ? t('Base verrouillée') : undefined}
          onClick={() => setOpen('props')}
        >
          {t('Propriétés')}
        </button>
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
            {schema.properties.length === 1 && (
              <p className="hint">{t('Aucune autre propriété.')}</p>
            )}
          </Popover>
        )}
      </span>
      <span className="toolbar-anchor new-row">
        <button className="primary" onClick={() => onNewRow()}>
          {t('Nouveau')}
        </button>
        <button
          className="primary split"
          aria-label={t('Choisir un modèle')}
          onClick={() => setOpen('new')}
        >
          ▾
        </button>
        {open === 'new' && (
          <Popover onClose={close} align="right">
            <div className="menu-label">{t('Modèles')}</div>
            {repeating ? (
              <RecurrenceEditor
                databaseId={databaseId}
                schema={schema}
                template={repeating}
                onClose={() => (setRepeating(null), close())}
              />
            ) : (
              templates.map((template) => (
                <div key={template.id} className="template-item">
                  <button className="menu-item" onClick={() => (close(), onNewRow(template.id))}>
                    <PageIcon icon={template.icon} fallback="📄" />{' '}
                    {template.title || t('Sans titre')}
                  </button>
                  <button
                    className="template-repeat"
                    title={t('Répéter ce modèle')}
                    aria-label={t('Répéter {title}', { title: template.title || t('Sans titre') })}
                    onClick={() => setRepeating(template)}
                  >
                    ↻
                  </button>
                </div>
              ))
            )}
            {templates.length === 0 && (
              <p className="hint">
                {t('Aucun modèle. Ouvrez une ligne et cochez « Modèle » pour en créer un.')}
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
        aria-label={t('Propriété')}
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
        aria-label={t('Condition')}
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
      <button title={t('Retirer le filtre')} onClick={onRemove}>
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
        aria-label={t('Valeur')}
        value={String(filter.value ?? '')}
        onChange={(e) => onValue(e.target.value || null)}
      >
        <option value="">{t('Choisir…')}</option>
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
        aria-label={t('Valeur')}
        value={String(filter.value ?? '')}
        onChange={(e) => onValue(e.target.value || null)}
      >
        <option value="">{t('Choisir…')}</option>
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
          aria-label={t('Date')}
          value={relative ? String(filter.value) : 'exact'}
          onChange={(e) => onValue(e.target.value === 'exact' ? null : e.target.value)}
        >
          <option value="exact">{t('Date précise')}</option>
          {Object.entries(RELATIVE_DATES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {!relative && (
          <input
            aria-label={t('Valeur')}
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
      aria-label={t('Valeur')}
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
