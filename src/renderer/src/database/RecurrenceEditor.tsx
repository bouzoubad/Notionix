import { useEffect, useState } from 'react'
import type { DatabaseRow, DatabaseSchema } from '../../../shared/database'
import {
  describeRule,
  UNIT_LABELS,
  type Recurrence,
  type RecurrenceRule,
  type RecurrenceUnit
} from '../../../shared/recurrence'
import { useStore } from '../store'

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const when = (ms: number): string =>
  new Date(ms).toLocaleString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Repeats a template on a schedule: a new row each day, chosen weekdays, month… */
export function RecurrenceEditor({
  databaseId,
  schema,
  template,
  onClose
}: {
  databaseId: string
  schema: DatabaseSchema
  template: DatabaseRow
  onClose: () => void
}): React.JSX.Element {
  const showNotice = useStore((s) => s.showNotice)
  const [current, setCurrent] = useState<Recurrence | null | undefined>(undefined)
  const [every, setEvery] = useState<RecurrenceUnit>('week')
  const [interval, setEveryN] = useState(1)
  const [weekdays, setWeekdays] = useState<number[]>([((new Date().getDay() + 6) % 7) + 1])
  const [time, setTime] = useState('08:00')
  const [dateProperty, setDateProperty] = useState('')
  const dates = schema.properties.filter((p) => p.type === 'date')

  useEffect(() => {
    let cancelled = false
    void window.api.databases.recurrences(databaseId).then((list) => {
      if (cancelled) return
      const mine = list.find((r) => r.templateId === template.id) ?? null
      setCurrent(mine)
      if (mine) {
        setEvery(mine.rule.every)
        setEveryN(mine.rule.interval)
        setWeekdays(mine.rule.weekdays ?? [])
        setTime(mine.rule.time)
        setDateProperty(mine.rule.dateProperty ?? '')
      }
    })
    return () => {
      cancelled = true
    }
  }, [databaseId, template.id])

  const save = async (rule: RecurrenceRule | null): Promise<void> => {
    try {
      const saved = await window.api.databases.setRecurrence(databaseId, template.id, rule)
      setCurrent(saved)
      showNotice(
        saved
          ? `« ${template.title || 'Sans titre'} » : prochaine création ${when(saved.nextAt)}.`
          : 'Répétition arrêtée.'
      )
      onClose()
    } catch (e) {
      showNotice(`Répétition impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const rule = (): RecurrenceRule => ({
    every,
    interval,
    time,
    // The rule keeps this person's offset: 8:00 is their 8:00, wherever the server is.
    utcOffset: -new Date().getTimezoneOffset(),
    ...(every === 'week' ? { weekdays } : {}),
    ...(dateProperty ? { dateProperty } : {})
  })

  if (current === undefined) return <div className="recurrence-editor">Chargement…</div>
  return (
    <div className="recurrence-editor">
      <div className="menu-label">Répéter « {template.title || 'Sans titre'} »</div>
      {current && (
        <p className="hint">
          {describeRule(current.rule)}. Prochaine : {when(current.nextAt)}.
        </p>
      )}
      <label className="menu-row">
        Tous les
        <input
          type="number"
          min={1}
          className="recurrence-interval"
          value={interval}
          onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
        />
        <select value={every} onChange={(e) => setEvery(e.target.value as RecurrenceUnit)}>
          {(Object.keys(UNIT_LABELS) as RecurrenceUnit[]).map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </label>
      {every === 'week' && (
        <div className="recurrence-days" role="group" aria-label="Jours">
          {WEEKDAYS.map((d, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={weekdays.includes(i + 1)}
              className={weekdays.includes(i + 1) ? 'active' : ''}
              onClick={() =>
                setWeekdays(
                  weekdays.includes(i + 1)
                    ? weekdays.filter((x) => x !== i + 1)
                    : [...weekdays, i + 1].sort()
                )
              }
            >
              {d}
            </button>
          ))}
        </div>
      )}
      <label className="menu-row">
        À
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      {dates.length > 0 && (
        <label className="menu-row">
          Date de la ligne
          <select value={dateProperty} onChange={(e) => setDateProperty(e.target.value)}>
            <option value="">—</option>
            {dates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="recurrence-actions">
        {current && <button onClick={() => void save(null)}>Arrêter</button>}
        <button className="primary" onClick={() => void save(rule())}>
          {current ? 'Modifier' : 'Répéter'}
        </button>
      </div>
    </div>
  )
}
