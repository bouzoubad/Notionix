import { useState } from 'react'
import { PageIcon } from '../components/PageIcon'
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
  onSchema,
  onUpdateRow
}: ViewProps): React.JSX.Element {
  const [over, setOver] = useState<string | null>(null)
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
  /** Moves a row so that it starts on `day`, keeping its length and its time of day. */
  const moveTo = (rowId: string, day: string): void => {
    const row = rows.find((r) => r.id === rowId)
    const value = row ? (rowValue(row, prop) as DateValue | null) : null
    if (!row || !value || value.start.slice(0, 10) === day) return
    const shift = (s: string): string => {
      const [y, m, d] = s.slice(0, 10).split('-').map(Number)
      const [ty, tm, td] = day.split('-').map(Number)
      const [fy, fm, fd] = value.start.slice(0, 10).split('-').map(Number)
      const delta = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
      return `${iso(new Date(y, m - 1, d + delta))}${s.slice(10)}`
    }
    onUpdateRow(row.id, {
      [prop.id]: value.end
        ? { start: shift(value.start), end: shift(value.end) }
        : { start: shift(value.start) }
    })
  }

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
              className={`calendar-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}${over === key ? ' drop' : ''}`}
              onDragOver={(e) => {
                if (!editable || !e.dataTransfer.types.includes('application/x-notionix-row'))
                  return
                e.preventDefault()
                setOver(key)
              }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const rowId = e.dataTransfer.getData('application/x-notionix-row')
                if (rowId) moveTo(rowId, key)
              }}
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
                <button
                  key={row.id}
                  className="calendar-item"
                  draggable={editable}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-notionix-row', row.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => onOpenRow(row.id)}
                >
                  {row.icon ? (
                    <>
                      <PageIcon icon={row.icon} />{' '}
                    </>
                  ) : (
                    ''
                  )}
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
