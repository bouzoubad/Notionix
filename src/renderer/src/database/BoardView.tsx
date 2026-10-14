import { useState } from 'react'
import { groupRows } from '../../../shared/database'
import { OptionTag } from './OptionTag'
import { RowSummary } from './RowSummary'
import type { ViewProps } from './viewTypes'

/** Kanban columns, one per option of the grouping select property; cards move by drag and drop. */
export function BoardView({
  schema,
  view,
  rows,
  onUpdateRow,
  onAddRow,
  onOpenRow,
  onSchema
}: ViewProps): React.JSX.Element {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null | undefined>(undefined)
  const prop = schema.properties.find((p) => p.id === view.groupBy && p.type === 'select')
  if (!prop) {
    const selects = schema.properties.filter((p) => p.type === 'select')
    return (
      <div className="view-empty">
        {selects.length ? (
          <label>
            Grouper le board par{' '}
            <select
              aria-label="Grouper par"
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
              <option value="">Choisir une propriété…</option>
              {selects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          'Ajoutez une propriété « Sélection » pour organiser ce board en colonnes.'
        )}
      </div>
    )
  }
  const groups = groupRows(rows, prop)
  return (
    <div className="board">
      {groups.map((g) => (
        <div
          key={g.key ?? 'none'}
          className={`board-column ${over === g.key && dragging ? 'drop-target' : ''}`}
          data-group={g.option?.name ?? ''}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            setOver(g.key)
          }}
          onDragLeave={() => setOver(undefined)}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging) onUpdateRow(dragging, { [prop.id]: g.key })
            setDragging(null)
            setOver(undefined)
          }}
        >
          <div className="board-column-head">
            {g.option ? (
              <OptionTag option={g.option} />
            ) : (
              <span className="muted">Sans {prop.name}</span>
            )}
            <span className="muted">{g.rows.length}</span>
          </div>
          {g.rows.map((row) => (
            <div
              key={row.id}
              className="board-card"
              data-row-id={row.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', row.title)
                setDragging(row.id)
              }}
              onDragEnd={() => setDragging(null)}
              onClick={() => onOpenRow(row.id)}
            >
              <div className="card-title">
                {row.icon ? `${row.icon} ` : ''}
                {row.title || <span className="muted">Sans titre</span>}
              </div>
              <RowSummary schema={schema} view={view} row={row} skip={[prop.id]} />
            </div>
          ))}
          <button className="board-add" onClick={() => onAddRow({ [prop.id]: g.key })}>
            + Nouveau
          </button>
        </div>
      ))}
    </div>
  )
}
