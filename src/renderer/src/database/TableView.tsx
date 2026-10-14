import { useState } from 'react'
import {
  PROPERTY_TYPE_LABELS,
  TITLE_PROPERTY_ID,
  newId,
  type PropertyDef,
  type PropertyType
} from '../../../shared/database'
import { Cell } from './Cell'
import { TYPE_ICONS, visibleProperties, type ViewProps } from './viewTypes'
import { Popover } from './Popover'
import { PropertyMenu } from './PropertyMenu'

export function TableView(props: ViewProps): React.JSX.Element {
  const { schema, view, rows } = props
  const [menu, setMenu] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = visibleProperties(schema, view)

  const addProperty = (type: PropertyType): void => {
    setAdding(false)
    const prop: PropertyDef = { id: newId(), name: PROPERTY_TYPE_LABELS[type], type }
    if (type === 'select' || type === 'multi_select') prop.options = []
    if (type === 'relation') prop.relationDatabaseId = null
    props.onSchema({ ...schema, properties: [...schema.properties, prop] })
    setMenu(prop.id)
  }

  return (
    <div className="table-view">
      <table className="db-table">
        <thead>
          <tr>
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
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((p) => (
                <td key={p.id} className={p.id === TITLE_PROPERTY_ID ? 'title-col' : ''}>
                  {p.id === TITLE_PROPERTY_ID && (
                    <button className="open-row" onClick={() => props.onOpenRow(row.id)}>
                      Ouvrir
                    </button>
                  )}
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
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <button className="add-row" onClick={() => props.onAddRow()}>
        + Nouvelle ligne
      </button>
      <div className="db-count">{rows.length} ligne(s)</div>
    </div>
  )
}
