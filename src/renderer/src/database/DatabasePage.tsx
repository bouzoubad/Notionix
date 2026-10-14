import { useState } from 'react'
import {
  VIEW_TYPE_LABELS,
  applyView,
  defaultView,
  type DatabaseSchema,
  type PropertyDef,
  type PropertyValue,
  type SelectOption,
  type ViewDef,
  type ViewType
} from '../../../shared/database'
import type { PageSummary } from '../../../shared/types'
import { PageDecorations } from '../components/PageDecorations'
import { ancestorsOf, useStore } from '../store'
import { Popover } from './Popover'
import { TableView } from './TableView'
import type { ViewProps } from './viewTypes'
import { Toolbar } from './Toolbar'
import { useDatabase } from './useDatabase'
import { VIEW_COMPONENTS } from './views'

const AVAILABLE_VIEWS = Object.keys(VIEW_COMPONENTS) as ViewType[]

/** A full-page database: title, views as tabs, toolbar and the active view. */
export function DatabasePage({ page }: { page: PageSummary }): React.JSX.Element {
  const db = useDatabase(page.id)
  const pages = useStore((s) => s.pages)
  const open = useStore((s) => s.open)
  const patch = useStore((s) => s.patch)
  const [title, setTitle] = useState(page.title)
  const [viewId, setViewId] = useState<string | null>(null)
  const [addingView, setAddingView] = useState(false)
  const [viewMenu, setViewMenu] = useState<string | null>(null)

  if (!db.data) return <div className="page" />
  const { schema, rows } = db.data
  const view = schema.views.find((v) => v.id === viewId) ?? schema.views[0]
  const shown = applyView(rows, schema, view)
  const templates = rows.filter((r) => r.isTemplate)
  const crumbs = ancestorsOf(pages, page.id)

  const patchView = (id: string, next: Partial<ViewDef>): void =>
    void db.saveSchema({
      ...schema,
      views: schema.views.map((v) => (v.id === id ? { ...v, ...next } : v))
    })
  const addView = (type: ViewType): void => {
    setAddingView(false)
    const created = defaultView(type)
    const select = schema.properties.find((p) => p.type === 'select')
    const date = schema.properties.find((p) => p.type === 'date')
    if (type === 'board') created.groupBy = select?.id ?? null
    if (type === 'calendar') created.dateProperty = date?.id ?? null
    void db.saveSchema({ ...schema, views: [...schema.views, created] })
    setViewId(created.id)
  }
  const createOption = async (prop: PropertyDef, option: SelectOption): Promise<void> => {
    const next: DatabaseSchema = {
      ...schema,
      properties: schema.properties.map((p) =>
        p.id === prop.id ? { ...p, options: [...(p.options ?? []), option] } : p
      )
    }
    await db.saveSchema(next)
  }
  const addRow = async (
    values?: Record<string, PropertyValue>,
    templateId?: string
  ): Promise<void> => {
    await db.addRow({ properties: values, templateId })
  }

  const viewProps: ViewProps = {
    databaseId: page.id,
    schema,
    view,
    rows: shown,
    onSchema: (s: DatabaseSchema) => void db.saveSchema(s),
    onChangeType: (propertyId, type) => void db.changeType(propertyId, type),
    onUpdateRow: (rowId, values) => void db.updateRow(rowId, values),
    onAddRow: (values) => void addRow(values),
    onOpenRow: (rowId) => open(rowId),
    onCreateOption: createOption
  }
  const ViewComponent = VIEW_COMPONENTS[view.type] ?? TableView

  return (
    <div className="page database-page">
      <div className="breadcrumbs">
        {crumbs.map((c) => (
          <button key={c.id} onClick={() => open(c.id)}>
            {c.icon ?? ''} {c.title || 'Sans titre'}
          </button>
        ))}
        <span>
          {page.icon ?? '🗃️'} {title || 'Sans titre'}
        </span>
      </div>
      <PageDecorations page={page} />
      <div className="db-body">
        <input
          className="page-title"
          value={title}
          placeholder="Base de données sans titre"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== page.title && void patch(page.id, { title })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="db-header">
          <div className="view-tabs" role="tablist">
            {schema.views.map((v) => (
              <span key={v.id} className="toolbar-anchor">
                <button
                  role="tab"
                  aria-selected={v.id === view.id}
                  className={v.id === view.id ? 'view-tab active' : 'view-tab'}
                  onClick={() => (v.id === view.id ? setViewMenu(v.id) : setViewId(v.id))}
                >
                  {v.name}
                </button>
                {viewMenu === v.id && (
                  <Popover onClose={() => setViewMenu(null)}>
                    <input
                      autoFocus
                      aria-label="Nom de la vue"
                      defaultValue={v.name}
                      onBlur={(e) =>
                        e.target.value.trim() && patchView(v.id, { name: e.target.value.trim() })
                      }
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <ViewSettings
                      schema={schema}
                      view={v}
                      onPatch={(next) => patchView(v.id, next)}
                    />
                    {schema.views.length > 1 && (
                      <button
                        className="menu-item danger"
                        onClick={() => {
                          setViewMenu(null)
                          setViewId(null)
                          void db.saveSchema({
                            ...schema,
                            views: schema.views.filter((x) => x.id !== v.id)
                          })
                        }}
                      >
                        Supprimer la vue
                      </button>
                    )}
                  </Popover>
                )}
              </span>
            ))}
            <span className="toolbar-anchor">
              <button
                className="view-tab"
                aria-label="Ajouter une vue"
                onClick={() => setAddingView(true)}
              >
                +
              </button>
              {addingView && (
                <Popover onClose={() => setAddingView(false)}>
                  <div className="menu-label">Nouvelle vue</div>
                  {AVAILABLE_VIEWS.map((t) => (
                    <button key={t} className="menu-item" onClick={() => addView(t)}>
                      {VIEW_TYPE_LABELS[t]}
                    </button>
                  ))}
                </Popover>
              )}
            </span>
          </div>
          <Toolbar
            schema={schema}
            view={view}
            templates={templates}
            onSchema={(s) => void db.saveSchema(s)}
            onNewRow={(templateId) => void addRow(undefined, templateId)}
          />
        </div>
        <ViewComponent {...viewProps} />
      </div>
    </div>
  )
}

/** Type-specific view settings: board grouping, calendar date property. */
function ViewSettings({
  schema,
  view,
  onPatch
}: {
  schema: DatabaseSchema
  view: ViewDef
  onPatch: (next: Partial<ViewDef>) => void
}): React.JSX.Element | null {
  if (view.type === 'board') {
    return (
      <label className="menu-row">
        Grouper par
        <select
          value={view.groupBy ?? ''}
          onChange={(e) => onPatch({ groupBy: e.target.value || null })}
        >
          <option value="">Choisir…</option>
          {schema.properties
            .filter((p) => p.type === 'select')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
    )
  }
  if (view.type === 'calendar') {
    return (
      <label className="menu-row">
        Date affichée
        <select
          value={view.dateProperty ?? ''}
          onChange={(e) => onPatch({ dateProperty: e.target.value || null })}
        >
          <option value="">Choisir…</option>
          {schema.properties
            .filter((p) => ['date', 'created_time', 'last_edited_time'].includes(p.type))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
    )
  }
  return null
}
