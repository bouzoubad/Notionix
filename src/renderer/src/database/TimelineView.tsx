import { useRef, useState } from 'react'
import { type DateValue, type DatabaseRow } from '../../../shared/database'
import type { ViewProps } from './viewTypes'
import { locale, t } from '../../../shared/i18n'

const DAY = 86_400_000
const pad = (n: number): string => String(n).padStart(2, '0')
const iso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayOf = (s: string): Date => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
const days = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / DAY)
const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Keeps the time of day of a date value when its day moves. */
const moveDay = (value: string, day: Date): string =>
  value.length > 10 ? `${iso(day)}${value.slice(10)}` : iso(day)

/**
 * Rows as bars across the days of their date range (Gantt). Drag a bar to
 * move it, drag its right edge to change its end. Dependencies, when turned
 * on, are drawn as arrows from the blocking row to the blocked one.
 */
export function TimelineView({
  schema,
  view,
  rows,
  onUpdateRow,
  onOpenRow,
  onAddRow,
  onSchema
}: ViewProps): React.JSX.Element {
  const prop = schema.properties.find((p) => p.id === view.dateProperty && p.type === 'date')
  const [drag, setDrag] = useState<{
    rowId: string
    mode: 'move' | 'end'
    startX: number
    delta: number
  } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const width = view.timelineScale === 'month' ? 14 : 36
  const setView = (next: Record<string, unknown>): void =>
    onSchema({
      ...schema,
      views: schema.views.map((v) => (v.id === view.id ? { ...v, ...next } : v))
    })

  if (!prop) {
    const dates = schema.properties.filter((p) => p.type === 'date')
    return (
      <div className="view-empty">
        {dates.length ? (
          <label>
            {t('Placer selon')}{' '}
            <select value="" onChange={(e) => setView({ dateProperty: e.target.value })}>
              <option value="">{t('Choisir une propriété…')}</option>
              {dates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          t('Ajoutez une propriété « Date » (avec date de fin) pour afficher la chronologie.')
        )}
      </div>
    )
  }

  const dated = rows.filter((r) => r.properties[prop.id])
  const undated = rows.filter((r) => !r.properties[prop.id])
  const today = new Date()
  const starts = dated.map((r) => dayOf((r.properties[prop.id] as DateValue).start))
  const ends = dated.map((r) => {
    const v = r.properties[prop.id] as DateValue
    return dayOf(v.end ?? v.start)
  })
  const first = addDays(new Date(Math.min(today.getTime(), ...starts.map((d) => d.getTime()))), -3)
  const last = addDays(new Date(Math.max(today.getTime(), ...ends.map((d) => d.getTime()))), 10)
  const span = days(first, last) + 1
  const columns = Array.from({ length: span }, (_, i) => addDays(first, i))

  const barOf = (row: DatabaseRow): { left: number; length: number } => {
    const v = row.properties[prop.id] as DateValue
    let start = dayOf(v.start)
    let end = dayOf(v.end ?? v.start)
    if (drag?.rowId === row.id) {
      const shift = Math.round(drag.delta / width)
      if (drag.mode === 'move') {
        start = addDays(start, shift)
        end = addDays(end, shift)
      } else end = addDays(end, Math.max(shift, days(end, start)))
    }
    return { left: days(first, start) * width, length: (days(start, end) + 1) * width }
  }

  const finish = (): void => {
    if (!drag) return
    const row = rows.find((r) => r.id === drag.rowId)
    const shift = Math.round(drag.delta / width)
    setDrag(null)
    if (!row || shift === 0) return
    const v = row.properties[prop.id] as DateValue
    const start = dayOf(v.start)
    const end = dayOf(v.end ?? v.start)
    const next: DateValue =
      drag.mode === 'move'
        ? {
            start: moveDay(v.start, addDays(start, shift)),
            end: v.end ? moveDay(v.end, addDays(end, shift)) : null
          }
        : {
            start: v.start,
            end: moveDay(v.end ?? v.start, addDays(end, Math.max(shift, days(end, start))))
          }
    onUpdateRow(row.id, { [prop.id]: next.end ? next : { start: next.start } })
  }

  const ROW = 34
  const index = new Map(dated.map((r, i) => [r.id, i]))
  const deps = schema.dependencies
  const arrows: { from: string; to: string }[] = []
  if (deps)
    for (const r of dated) {
      const blockedBy = r.properties[deps.blockedByPropertyId]
      for (const b of Array.isArray(blockedBy) ? blockedBy : [])
        if (index.has(b)) arrows.push({ from: b, to: r.id })
    }

  return (
    <div className="timeline-view">
      <div className="timeline-tools">
        <select
          aria-label={t('Échelle')}
          value={view.timelineScale ?? 'week'}
          onChange={(e) => setView({ timelineScale: e.target.value })}
        >
          <option value="week">{t('Jours')}</option>
          <option value="month">{t('Mois')}</option>
        </select>
        <button onClick={() => onAddRow({ [prop.id]: { start: iso(today) } })}>
          {t('+ Nouvelle ligne')}
        </button>
      </div>
      <div
        className="timeline-scroll"
        ref={area}
        onPointerMove={(e) => drag && setDrag({ ...drag, delta: e.clientX - drag.startX })}
        onPointerUp={finish}
        onPointerLeave={finish}
      >
        <div className="timeline-grid" style={{ width: span * width }}>
          <div className="timeline-header">
            {columns.map((d) => (
              <span
                key={iso(d)}
                className={`timeline-day${iso(d) === iso(today) ? ' today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' weekend' : ''}`}
                style={{ width }}
              >
                {view.timelineScale === 'month'
                  ? d.getDate() === 1
                    ? d.toLocaleDateString(locale(), { month: 'short' })
                    : ''
                  : d.getDate()}
              </span>
            ))}
          </div>
          <div className="timeline-rows" style={{ height: dated.length * ROW + 8 }}>
            <svg className="timeline-arrows" width={span * width} height={dated.length * ROW + 8}>
              {arrows.map(({ from, to }) => {
                const a = barOf(dated[index.get(from)!])
                const b = barOf(dated[index.get(to)!])
                const y1 = index.get(from)! * ROW + ROW / 2
                const y2 = index.get(to)! * ROW + ROW / 2
                const x1 = a.left + a.length
                const x2 = b.left
                return (
                  <path
                    key={`${from}-${to}`}
                    d={`M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`}
                    markerEnd="url(#arrow)"
                  />
                )
              })}
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
            </svg>
            {dated.map((row, i) => {
              const bar = barOf(row)
              return (
                <div
                  key={row.id}
                  className="timeline-bar"
                  style={{ top: i * ROW + 4, left: bar.left, width: bar.length }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).classList.contains('timeline-handle')) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setDrag({ rowId: row.id, mode: 'move', startX: e.clientX, delta: 0 })
                  }}
                  onDoubleClick={() => onOpenRow(row.id)}
                  title={t('Glisser pour déplacer, double-cliquer pour ouvrir')}
                >
                  <span className="timeline-title">{row.title || t('Sans titre')}</span>
                  <span
                    className="timeline-handle"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setDrag({ rowId: row.id, mode: 'end', startX: e.clientX, delta: 0 })
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {undated.length > 0 && (
        <div className="timeline-undated">
          <span className="muted">{t('Sans date :')}</span>
          {undated.map((r) => (
            <button
              key={r.id}
              onClick={() => onUpdateRow(r.id, { [prop.id]: { start: iso(today) } })}
            >
              {t('{title} → aujourd’hui', { title: r.title || t('Sans titre') })}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
