/** "à l'instant", "il y a 5 min", "hier", or the date. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000)
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 2 * 86400) return 'hier'
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
