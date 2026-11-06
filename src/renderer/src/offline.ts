import { useEffect, useState, useSyncExternalStore } from 'react'
import { locale, t } from '../../shared/i18n'
import { platform, type OfflineStatus } from './platform'
import { ago } from './time'

const never = (): (() => void) => () => undefined
const none = (): null => null

/** Where keeping pages for working without network stands; null when the app does not. */
export function useOfflineStatus(): OfflineStatus | null {
  const copies = platform().offline
  const status = useSyncExternalStore(copies?.subscribe ?? never, copies?.status ?? none)
  // "il y a 5 min" moves on by itself.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!copies) return
    const timer = window.setInterval(() => tick((n) => n + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [copies])
  return status
}

const DAY = 24 * 60 * 60 * 1000

/** « il y a 2 h », « hier », or « le 6 nov. ». */
function since(at: number, now = Date.now()): string {
  return now - at >= 2 * DAY
    ? t('le {date}', {
        date: new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
      })
    : ago(at, now)
}

/** « Synchronisé il y a 2 h », or null when never synced. */
export function syncedText(status: OfflineStatus): string | null {
  return status.at ? t('Synchronisé {since}', { since: since(status.at) }) : null
}

/** « Synchronisé il y a 2 h », « Synchronisation… 120 / 700 pages », « Hors ligne · synchronisé… ». */
export function offlineStatusText(status: OfflineStatus, connected: boolean): string {
  if (!connected)
    return status.at
      ? t('Hors ligne · synchronisé {since}', { since: since(status.at) })
      : t('Hors ligne · pas encore synchronisé')
  if (status.running)
    return t('Synchronisation… {done} / {total} pages', { done: status.done, total: status.total })
  return status.at
    ? t('Synchronisé {since}', { since: since(status.at) })
    : t('Synchronisation en attente')
}

/** A size in bytes as people read it (« 12 Mo »). */
export function formatSize(bytes: number): string {
  const units = [t('octets'), t('Ko'), t('Mo'), t('Go')]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit > 0 && value < 10 ? 1 : 0
  return `${value.toLocaleString(locale(), { maximumFractionDigits: digits })} ${units[unit]}`
}
