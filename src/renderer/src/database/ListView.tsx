import { RowSummary } from './RowSummary'
import type { ViewProps } from './viewTypes'

export function ListView({
  schema,
  view,
  rows,
  onOpenRow,
  onAddRow
}: ViewProps): React.JSX.Element {
  return (
    <div className="list-view">
      {rows.map((row) => (
        <button key={row.id} className="list-item" onClick={() => onOpenRow(row.id)}>
          <span className="list-title">
            {row.icon ?? '📄'} {row.title || <span className="muted">Sans titre</span>}
          </span>
          <RowSummary schema={schema} view={view} row={row} />
        </button>
      ))}
      <button className="add-row" onClick={() => onAddRow()}>
        + Nouvelle ligne
      </button>
    </div>
  )
}
