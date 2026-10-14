import { useState } from 'react'
import { rowValue, type DateValue } from '../../../shared/database'
import type { ViewProps } from './viewTypes'

const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const pad = (n: number): string => String(n).padStart(2, '0')
const iso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Month grid starting on Monday; a row appears on every day of its date range. */
export function CalendarView({
  schema,
  view,
  rows,
  onAddRow,
  onOpenRow,
  onSchema
}: ViewProps): React.JSX.Element {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const prop = schema.properties.find((p) => p.id === view.dateProperty)
  if (!prop) {
    const dates = schema.properties.filter((p) =>
      ['date', 'created_time', 'last_edited_time'].includes(p.type)
    )
    return (
      <div className="view-empty">
        {dates.length ? (
          <label>
            Afficher selon{' '}
            <select
              aria-label="Date affichée"
              value=""
              onChange={(e) =>
                onSchema({
                  ...schema,
                  views: schema.views.map((v) =>
                    v.id === view.id ? { ...v, dateProperty: e.target.value } : v
                  )
                })
              }
            >
              <option value="">Choisir une propriété…</option>
              {dates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          'Ajoutez une propriété « Date » pour afficher ce calendrier.'
        )}
      </div>
    )
  }

  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  )
  const today = iso(new Date())
  const byDay = new Map<string, typeof rows>()
  for (const row of rows) {
    const value = rowValue(row, prop) as DateValue | null
    if (!value) continue
    const from = value.start.slice(0, 10)
    const to = (value.end ?? value.start).slice(0, 10)
    for (const d of days) {
      const key = iso(d)
      if (key >= from && key <= to) byDay.set(key, [...(byDay.get(key) ?? []), row])
    }
  }
  const shift = (n: number): void =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  const editable = prop.type === 'date'

  return (
    <div className="calendar">
      <div className="calendar-head">
        <strong className="calendar-month">
          {month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
        </strong>
        <span>
          <button aria-label="Mois précédent" onClick={() => shift(-1)}>
            ‹
          </button>
          <button
            onClick={() => {
              const now = new Date()
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
            }}
          >
            Aujourd’hui
          </button>
          <button aria-label="Mois suivant" onClick={() => shift(1)}>
            ›
          </button>
        </span>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="calendar-weekday">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = iso(d)
          return (
            <div
              key={key}
              data-date={key}
              className={`calendar-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}`}
            >
              <span className="calendar-date">
                {d.getDate()}
                {editable && (
                  <button
                    className="calendar-add"
                    aria-label={`Ajouter le ${key}`}
                    onClick={() => onAddRow({ [prop.id]: { start: key } })}
                  >
                    +
                  </button>
                )}
              </span>
              {(byDay.get(key) ?? []).map((row) => (
                <button key={row.id} className="calendar-item" onClick={() => onOpenRow(row.id)}>
                  {row.icon ? `${row.icon} ` : ''}
                  {row.title || 'Sans titre'}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
