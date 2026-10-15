import { Fragment } from 'react'
import { groupRows, type DatabaseRow, type PropertyValue } from '../../../shared/database'
import { OptionTag } from './OptionTag'
import { RowSummary } from './RowSummary'
import { useRowDrag } from './rowDrag'
import { canReorder, groupProperty, nameOf, type ViewProps } from './viewTypes'

export function ListView({
  schema,
  view,
  rows,
  onOpenRow,
  onAddRow,
  onMoveRow
}: ViewProps): React.JSX.Element {
  const reorder = canReorder(view)
  const drag = useRowDrag(reorder, onMoveRow)
  const groupProp = groupProperty(schema, view)

  const items = (
    list: DatabaseRow[],
    values?: Record<string, PropertyValue>
  ): React.JSX.Element[] =>
    list.map((row) => (
      <div
        key={row.id}
        data-row-id={row.id}
        className={`list-row ${drag.dropClass(row.id)}`}
        {...drag.target(row, list, values)}
      >
        {reorder && (
          <span className="row-drag" title="Glisser pour déplacer" {...drag.handle(row.id)}>
            ⋮⋮
          </span>
        )}
        <button className="list-item" onClick={() => onOpenRow(row.id)}>
          <span className="list-title">
            {row.icon ?? '📄'} {row.title || <span className="muted">Sans titre</span>}
          </span>
          <RowSummary
            schema={schema}
            view={view}
            row={row}
            skip={groupProp ? [groupProp.id] : []}
          />
        </button>
      </div>
    ))

  return (
    <div className="list-view">
      {groupProp
        ? groupRows(rows, groupProp, nameOf).map((g) => {
            const values = { [groupProp.id]: g.value }
            return (
              <Fragment key={g.key ?? 'none'}>
                <div className="list-group" {...drag.end(values)}>
                  {g.option ? (
                    <OptionTag option={g.option} />
                  ) : (
                    <span className="group-label">{g.label}</span>
                  )}
                  <span className="muted">{g.rows.length}</span>
                </div>
                {items(g.rows, values)}
              </Fragment>
            )
          })
        : items(rows)}
      <button className="add-row" onClick={() => onAddRow()} {...drag.end()}>
        + Nouvelle ligne
      </button>
    </div>
  )
}
