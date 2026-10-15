import { Fragment, useState } from 'react'
import {
  PROPERTY_TYPE_LABELS,
  TITLE_PROPERTY_ID,
  groupRows,
  newId,
  defaultStatusOptions,
  type DatabaseRow,
  type PropertyDef,
  type PropertyType,
  type PropertyValue,
  type RowGroup
} from '../../../shared/database'
import { Cell } from './Cell'
import {
  TYPE_ICONS,
  canReorder,
  groupProperty,
  nameOf,
  visibleProperties,
  type ViewProps
} from './viewTypes'
import { OptionTag } from './OptionTag'
import { useRowDrag } from './rowDrag'
import { Popover } from './Popover'
import { PropertyMenu } from './PropertyMenu'

export function TableView(props: ViewProps): React.JSX.Element {
  const { schema, view, rows } = props
  const [menu, setMenu] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = visibleProperties(schema, view)
  const reorder = canReorder(view)
  const drag = useRowDrag(reorder, props.onMoveRow)
  const groupProp = groupProperty(schema, view)
  const groups = groupProp ? groupRows(rows, groupProp, nameOf) : null
  const [collapsed, setCollapsed] = useState<Set<string | null>>(new Set())
  const toggleGroup = (key: string | null): void =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const groupValues = (g: RowGroup): Record<string, PropertyValue> | undefined =>
    groupProp ? { [groupProp.id]: g.value } : undefined

  // Sub-items: rows nest under their parent (when the view is not grouped).
  const nesting = groupProp ? null : (schema.subItems ?? null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const childrenOf = (id: string): string[] => {
    const v = nesting ? rows.find((r) => r.id === id)?.properties[nesting.childrenPropertyId] : null
    return Array.isArray(v) ? v : []
  }
  const nested = (list: DatabaseRow[]): { row: DatabaseRow; depth: number }[] => {
    if (!nesting) return list.map((row) => ({ row, depth: 0 }))
    const shown = new Map(list.map((r) => [r.id, r]))
    const parentOf = (r: DatabaseRow): string | null => {
      const v = r.properties[nesting.parentPropertyId]
      return Array.isArray(v) && v[0] && shown.has(v[0]) ? v[0] : null
    }
    const out: { row: DatabaseRow; depth: number }[] = []
    const seen = new Set<string>()
    const visit = (r: DatabaseRow, depth: number): void => {
      if (seen.has(r.id)) return
      seen.add(r.id)
      out.push({ row: r, depth })
      if (folded.has(r.id)) return
      for (const child of list) if (parentOf(child) === r.id) visit(child, depth + 1)
    }
    for (const r of list) if (!parentOf(r)) visit(r, 0)
    return out
  }

  const rowsOf = (
    list: DatabaseRow[],
    values?: Record<string, PropertyValue>
  ): React.JSX.Element[] =>
    nested(list).map(({ row, depth }) => (
      <tr
        key={row.id}
        data-row-id={row.id}
        className={drag.dropClass(row.id)}
        {...drag.target(row, list, values)}
      >
        <td className="drag-col">
          {reorder && (
            <span className="row-drag" title="Glisser pour déplacer" {...drag.handle(row.id)}>
              ⋮⋮
            </span>
          )}
        </td>
        {columns.map((p) => (
          <td key={p.id} className={p.id === TITLE_PROPERTY_ID ? 'title-col' : ''}>
            {p.id === TITLE_PROPERTY_ID && (
              <button className="open-row" onClick={() => props.onOpenRow(row.id)}>
                Ouvrir
              </button>
            )}
            {p.id === TITLE_PROPERTY_ID && nesting ? (
              // Sub-items: the title moves right with the depth, after the fold button.
              <div className="sub-row" style={{ paddingLeft: depth * 18 }}>
                <span className="sub-indent">
                  {childrenOf(row.id).length > 0 && (
                    <button
                      className="sub-toggle"
                      aria-expanded={!folded.has(row.id)}
                      onClick={() =>
                        setFolded((f) => {
                          const next = new Set(f)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })
                      }
                    >
                      {folded.has(row.id) ? '▸' : '▾'}
                    </button>
                  )}
                </span>
                <Cell
                  prop={p}
                  row={row}
                  onChange={(value) =>
                    props.onUpdateRow(
                      row.id,
                      p.id === TITLE_PROPERTY_ID ? { title: value } : { [p.id]: value }
                    )
                  }
                  onCreateOption={props.onCreateOption}
                />
              </div>
            ) : (
              <Cell
                prop={p}
                row={row}
                onChange={(value) =>
                  props.onUpdateRow(
                    row.id,
                    p.id === TITLE_PROPERTY_ID ? { title: value } : { [p.id]: value }
                  )
                }
                onCreateOption={props.onCreateOption}
              />
            )}
          </td>
        ))}
        <td />
      </tr>
    ))

  const addProperty = (type: PropertyType): void => {
    setAdding(false)
    const prop: PropertyDef = { id: newId(), name: PROPERTY_TYPE_LABELS[type], type }
    if (type === 'select' || type === 'multi_select') prop.options = []
    if (type === 'status') prop.options = defaultStatusOptions()
    if (type === 'relation') prop.relationDatabaseId = null
    props.onSchema({ ...schema, properties: [...schema.properties, prop] })
    setMenu(prop.id)
  }

  return (
    <div className="table-view">
      <table className="db-table">
        <thead>
          <tr>
            <th className="drag-col" aria-hidden />
            {columns.map((p) => (
              <th key={p.id} className={p.id === TITLE_PROPERTY_ID ? 'title-col' : ''}>
                <button className="col-head" onClick={() => setMenu(p.id)}>
                  <span className="type-icon">{TYPE_ICONS[p.type]}</span> {p.name}
                </button>
                {menu === p.id && (
                  <PropertyMenu
                    prop={p}
                    schema={schema}
                    view={view}
                    databaseId={props.databaseId}
                    onSchema={props.onSchema}
                    onChangeType={(type) => props.onChangeType(p.id, type)}
                    onClose={() => setMenu(null)}
                  />
                )}
              </th>
            ))}
            <th className="add-col">
              <button aria-label="Ajouter une propriété" onClick={() => setAdding(true)}>
                +
              </button>
              {adding && (
                <Popover onClose={() => setAdding(false)} align="right">
                  <div className="menu-label">Nouvelle propriété</div>
                  {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[])
                    .filter((t) => t !== 'title')
                    .map((t) => (
                      <button key={t} className="menu-item" onClick={() => addProperty(t)}>
                        <span className="type-icon">{TYPE_ICONS[t]}</span> {PROPERTY_TYPE_LABELS[t]}
                      </button>
                    ))}
                </Popover>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups === null
            ? rowsOf(rows)
            : groups.map((g) => (
                <Fragment key={g.key ?? 'none'}>
                  <tr className="group-row" {...drag.end(groupValues(g))}>
                    <td colSpan={columns.length + 2}>
                      <button
                        className="group-toggle"
                        aria-expanded={!collapsed.has(g.key)}
                        onClick={() => toggleGroup(g.key)}
                      >
                        {collapsed.has(g.key) ? '▸' : '▾'}
                      </button>
                      {g.option ? (
                        <OptionTag option={g.option} />
                      ) : (
                        <span className="group-label">{g.label}</span>
                      )}
                      <span className="muted">{g.rows.length}</span>
                      <button className="group-add" onClick={() => props.onAddRow(groupValues(g))}>
                        +
                      </button>
                    </td>
                  </tr>
                  {!collapsed.has(g.key) && rowsOf(g.rows, groupValues(g))}
                </Fragment>
              ))}
        </tbody>
      </table>
      <button className="add-row" onClick={() => props.onAddRow()} {...drag.end()}>
        + Nouvelle ligne
      </button>
      {!reorder && rows.length > 1 && (
        <p className="hint">Retirez le tri pour réordonner les lignes à la main.</p>
      )}
      <div className="db-count">{rows.length} ligne(s)</div>
    </div>
  )
}
