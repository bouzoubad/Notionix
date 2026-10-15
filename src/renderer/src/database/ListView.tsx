import { Fragment } from 'react'
import { PageIcon } from '../components/PageIcon'
import { groupRows, type DatabaseRow, type PropertyValue } from '../../../shared/database'
import { OptionTag } from './OptionTag'
import { RowSummary } from './RowSummary'
import { useRowDrag } from './rowDrag'
import {
  canReorder,
  groupProperty,
  groupValues,
  nameOf,
  subGroupProperty,
  type ViewProps
} from './viewTypes'

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
            <PageIcon icon={row.icon} fallback="📄" />{' '}
            {row.title || <span className="muted">Sans titre</span>}
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
            const values = groupValues(groupProp, g)
            // Sub-groups: the rows of each group, grouped again.
            const sub = subGroupProperty(schema, view)
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
                {sub
                  ? groupRows(g.rows, sub, nameOf)
                      .filter((sg) => sg.rows.length > 0)
                      .map((sg) => {
                        const subValues = { ...values, ...groupValues(sub, sg) }
                        return (
                          <Fragment key={sg.key ?? 'none'}>
                            <div className="list-group sub" {...drag.end(subValues)}>
                              {sg.option ? (
                                <OptionTag option={sg.option} />
                              ) : (
                                <span className="group-label">{sg.label}</span>
                              )}
                              <span className="muted">{sg.rows.length}</span>
                            </div>
                            {items(sg.rows, subValues)}
                          </Fragment>
                        )
                      })
                  : items(g.rows, values)}
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
