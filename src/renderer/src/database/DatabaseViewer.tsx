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
import { useStore } from '../store'
import { Popover } from './Popover'
import { TableView } from './TableView'
import type { ViewProps } from './viewTypes'
import { Toolbar } from './Toolbar'
import type { DatabaseApi } from './useDatabase'
import { VIEW_COMPONENTS } from './views'

const AVAILABLE_VIEWS = Object.keys(VIEW_COMPONENTS) as ViewType[]

/** A full-page database: title, views as tabs, toolbar and the active view. */
/** Views as tabs, the toolbar and the active view of a database (full page or inline block). */
export function DatabaseViewer({
  databaseId,
  db
}: {
  databaseId: string
  db: DatabaseApi
}): React.JSX.Element {
  const open = useStore((s) => s.open)
  const [viewId, setViewId] = useState<string | null>(null)
  const [addingView, setAddingView] = useState(false)
  const [viewMenu, setViewMenu] = useState<string | null>(null)

  if (!db.data) return <div className="db-loading" />
  const { schema, rows } = db.data
  const view = schema.views.find((v) => v.id === viewId) ?? schema.views[0]
  const shown = applyView(rows, schema, view)
  const templates = rows.filter((r) => r.isTemplate)

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

  /** Manual order: the row takes the place of `beforeRowId` among all rows of the database. */
  const moveRow = async (
    rowId: string,
    beforeRowId: string | null,
    values?: Record<string, PropertyValue>
  ): Promise<void> => {
    const siblings = [...rows].sort((a, b) => a.position - b.position).filter((r) => r.id !== rowId)
    const found = beforeRowId ? siblings.findIndex((r) => r.id === beforeRowId) : -1
    if (values) await db.updateRow(rowId, values)
    await window.api.pages.move(rowId, databaseId, found < 0 ? siblings.length : found)
    await db.reload()
  }

  const viewProps: ViewProps = {
    databaseId,
    schema,
    view,
    rows: shown,
    onSchema: (s: DatabaseSchema) => void db.saveSchema(s),
    onChangeType: (propertyId, type) => void db.changeType(propertyId, type),
    onUpdateRow: (rowId, values) => void db.updateRow(rowId, values),
    onAddRow: (values) => void addRow(values),
    onOpenRow: (rowId) => open(rowId),
    onCreateOption: createOption,
    onMoveRow: (rowId, beforeRowId, values) => void moveRow(rowId, beforeRowId, values)
  }
  const ViewComponent = VIEW_COMPONENTS[view.type] ?? TableView

  return (
    <div className="db-viewer">
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
  if (view.type === 'board' || view.type === 'table' || view.type === 'list') {
    return (
      <label className="menu-row">
        Grouper par
        <select
          value={view.groupBy ?? ''}
          onChange={(e) => onPatch({ groupBy: e.target.value || null })}
        >
          <option value="">{view.type === 'board' ? 'Choisir…' : 'Aucun groupe'}</option>
          {schema.properties
            .filter((p) => p.type === 'select' || p.type === 'checkbox')
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
