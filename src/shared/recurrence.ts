/**
 * Recurring templates: a database template that becomes a new row on a
 * schedule (every day, chosen weekdays, every month…), like Notion's
 * "Repeat" templates. Times are those of the person who set the schedule:
 * their UTC offset is kept with the rule, so a server in another time zone
 * still creates the row at their 8:00.
 */

import { t } from './i18n'

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'

export interface RecurrenceRule {
  every: RecurrenceUnit
  /** Every `interval` units (every 2 weeks…) */
  interval: number
  /** Weekly: ISO weekdays, 1 (Monday) to 7 (Sunday) */
  weekdays?: number[]
  /** Local time of creation, "HH:mm" */
  time: string
  /** Minutes to add to UTC for the local time of the rule (UTC+2 → 120) */
  utcOffset: number
  /** Date property set to the day of the occurrence, if any */
  dateProperty?: string | null
}

export interface Recurrence {
  id: string
  databaseId: string
  templateId: string
  rule: RecurrenceRule
  /** Next creation (ms) */
  nextAt: number
}

export const UNIT_LABELS: Record<RecurrenceUnit, string> = {
  day: t('jour(s)'),
  week: t('semaine(s)'),
  month: t('mois'),
  year: t('an(s)')
}
const MAX_INTERVAL: Record<RecurrenceUnit, number> = { day: 365, week: 52, month: 24, year: 5 }

/** A rule from untrusted input; throws with a readable message. */
export function parseRule(raw: unknown): RecurrenceRule {
  if (typeof raw !== 'object' || raw === null) throw new Error(t('Règle de répétition invalide.'))
  const r = raw as Record<string, unknown>
  const every = r.every
  if (every !== 'day' && every !== 'week' && every !== 'month' && every !== 'year')
    throw new Error(t('Fréquence inconnue.'))
  const interval = Number(r.interval ?? 1)
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL[every])
    throw new Error(t('Intervalle invalide (1 à {max}).', { max: MAX_INTERVAL[every] }))
  const time =
    typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : null
  if (!time) throw new Error(t('Heure invalide (HH:mm).'))
  const utcOffset = Number(r.utcOffset ?? 0)
  if (!Number.isInteger(utcOffset) || Math.abs(utcOffset) > 14 * 60)
    throw new Error(t('Fuseau horaire invalide.'))
  const rule: RecurrenceRule = { every, interval, time, utcOffset }
  if (every === 'week') {
    const days = Array.isArray(r.weekdays)
      ? [...new Set(r.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))]
      : []
    if (!days.length) throw new Error(t('Choisissez au moins un jour de la semaine.'))
    rule.weekdays = days.sort()
  }
  if (typeof r.dateProperty === 'string' && r.dateProperty) rule.dateProperty = r.dateProperty
  return rule
}

const DAY = 864e5
/** Days since 1970 of a "local" day (local time read as UTC). */
const dayNumber = (local: Date): number =>
  Math.floor(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) / DAY)
const isoWeekday = (local: Date): number => local.getUTCDay() || 7
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/**
 * The first occurrence strictly after `after` (ms), counting intervals from
 * `anchor` (ms, the schedule's first day). Null if none within ten years.
 */
export function nextOccurrence(rule: RecurrenceRule, after: number, anchor: number): number | null {
  const shift = rule.utcOffset * 6e4
  const [hh, mm] = rule.time.split(':').map(Number)
  const a = new Date(anchor + shift)
  const anchorDay = dayNumber(a)
  // Monday of the anchor's week, for weekly intervals.
  const anchorMonday = anchorDay - (isoWeekday(a) - 1)
  const start = new Date(after + shift)
  for (let i = 0; i < 3700; i++) {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i)
    )
    const n = dayNumber(d)
    if (n < anchorDay) continue
    let match: boolean
    switch (rule.every) {
      case 'day':
        match = (n - anchorDay) % rule.interval === 0
        break
      case 'week': {
        const monday = n - (isoWeekday(d) - 1)
        match =
          (rule.weekdays ?? [isoWeekday(a)]).includes(isoWeekday(d)) &&
          ((monday - anchorMonday) / 7) % rule.interval === 0
        break
      }
      case 'month': {
        const months =
          (d.getUTCFullYear() - a.getUTCFullYear()) * 12 + (d.getUTCMonth() - a.getUTCMonth())
        const day = Math.min(a.getUTCDate(), daysInMonth(d.getUTCFullYear(), d.getUTCMonth()))
        match = months % rule.interval === 0 && d.getUTCDate() === day
        break
      }
      case 'year': {
        const day = Math.min(a.getUTCDate(), daysInMonth(d.getUTCFullYear(), a.getUTCMonth()))
        match =
          (d.getUTCFullYear() - a.getUTCFullYear()) % rule.interval === 0 &&
          d.getUTCMonth() === a.getUTCMonth() &&
          d.getUTCDate() === day
        break
      }
    }
    if (!match) continue
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) - shift
    if (at > after) return at
  }
  return null
}

/** The local day of an occurrence, "YYYY-MM-DD", for its date property. */
export function occurrenceDay(rule: RecurrenceRule, at: number): string {
  return new Date(at + rule.utcOffset * 6e4).toISOString().slice(0, 10)
}

/** "Toutes les 2 semaines, lun. et jeu., à 08:00" */
export function describeRule(rule: RecurrenceRule): string {
  const names = [t('lun.'), t('mar.'), t('mer.'), t('jeu.'), t('ven.'), t('sam.'), t('dim.')]
  const n = rule.interval
  const every =
    n === 1
      ? {
          day: t('Tous les jours'),
          week: t('Toutes les semaines'),
          month: t('Tous les mois'),
          year: t('Tous les ans')
        }[rule.every]
      : {
          day: t('Tous les {n} jours', { n }),
          week: t('Toutes les {n} semaines', { n }),
          month: t('Tous les {n} mois', { n }),
          year: t('Tous les {n} ans', { n })
        }[rule.every]
  const days =
    rule.every === 'week' && rule.weekdays?.length
      ? rule.weekdays.map((d) => names[d - 1]).join(t(' et '))
      : ''
  return days
    ? t('{every}, {days}, à {time}', { every, days, time: rule.time })
    : t('{every}, à {time}', { every, time: rule.time })
}
