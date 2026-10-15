import { locale, t } from '../../shared/i18n'

/** "à l'instant", "il y a 5 min", "hier", or the date. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000)
  if (s < 60) return t('à l’instant')
  if (s < 3600) return t('il y a {n} min', { n: Math.floor(s / 60) })
  if (s < 86400) return t('il y a {n} h', { n: Math.floor(s / 3600) })
  if (s < 2 * 86400) return t('hier')
  return new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
}
