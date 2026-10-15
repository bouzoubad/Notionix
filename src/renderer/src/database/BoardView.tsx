import { GROUPABLE_TYPES, groupRows, type PropertyValue } from '../../../shared/database'
import { PageIcon } from '../components/PageIcon'
import { OptionTag } from './OptionTag'
import { RowSummary } from './RowSummary'
import { useRowDrag } from './rowDrag'
import { canReorder, groupValues, nameOf, type ViewProps } from './viewTypes'
import { t } from '../../../shared/i18n'

/**
 * Kanban columns, one per option of the grouping property (select or
 * checkbox). Moving a card to another column changes its value; within a
 * column, cards keep the manual order unless the view is sorted.
 */
export function BoardView({
  schema,
  view,
  rows,
  onUpdateRow,
  onAddRow,
  onOpenRow,
  onSchema,
  onMoveRow
}: ViewProps): React.JSX.Element {
  const reorder = canReorder(view)
  const move = (
    rowId: string,
    beforeRowId: string | null,
    values?: Record<string, PropertyValue>
  ): void => {
    if (reorder) onMoveRow(rowId, beforeRowId, values)
    else if (values) onUpdateRow(rowId, values)
  }
  const drag = useRowDrag(true, move)
  const prop = schema.properties.find(
    (p) => p.id === view.groupBy && GROUPABLE_TYPES.includes(p.type)
  )
  if (!prop) {
    const choices = schema.properties.filter((p) =>
      ['select', 'checkbox', 'status', 'person'].includes(p.type)
    )
    return (
      <div className="view-empty">
        {choices.length ? (
          <label>
            {t('Grouper le board par')}{' '}
            <select
              aria-label={t('Grouper par')}
              value=""
              onChange={(e) =>
                onSchema({
                  ...schema,
                  views: schema.views.map((v) =>
                    v.id === view.id ? { ...v, groupBy: e.target.value } : v
                  )
                })
              }
            >
              <option value="">{t('Choisir une propriété…')}</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          t(
            'Ajoutez une propriété « Sélection » ou « Case à cocher » pour organiser ce board en colonnes.'
          )
        )}
      </div>
    )
  }
  return (
    <div className="board">
      {groupRows(rows, prop, nameOf).map((g) => {
        const values = groupValues(prop, g)
        return (
          <div
            key={g.key ?? 'none'}
            className="board-column"
            data-group={g.label}
            {...drag.end(values)}
          >
            <div className="board-column-head">
              {g.option ? (
                <OptionTag option={g.option} />
              ) : (
                <span className="muted">{g.label}</span>
              )}
              <span className="muted">{g.rows.length}</span>
            </div>
            {g.rows.map((row) => (
              <div
                key={row.id}
                className={`board-card ${drag.dropClass(row.id)}`}
                data-row-id={row.id}
                {...drag.handle(row.id)}
                {...drag.target(row, g.rows, values)}
                onClick={() => onOpenRow(row.id)}
              >
                <div className="card-title">
                  {row.icon ? (
                    <>
                      <PageIcon icon={row.icon} />{' '}
                    </>
                  ) : (
                    ''
                  )}
                  {row.title || <span className="muted">{t('Sans titre')}</span>}
                </div>
                <RowSummary schema={schema} view={view} row={row} skip={[prop.id]} />
              </div>
            ))}
            <button className="board-add" onClick={() => onAddRow(values)}>
              {t('+ Nouveau')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
