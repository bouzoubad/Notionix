/**
 * Pictograms for page icons, like Notion's « Icônes » tab: the open Lucide
 * set (ISC licence), drawn in one of the app's colours. A page icon
 * `icon:<name>:<colour>` is one of them (e.g. "icon:rocket:blue").
 */

/** An icon as Lucide gives it: SVG elements and their attributes. */
export type IconNode = [string, Record<string, string | number>][]

export interface Pictogram {
  /** kebab-case: "rocket", "calendar-days" */
  name: string
  node: IconNode
}

const PREFIX = 'icon:'
/** The colours of a pictogram: the app's text colours, or « default » (grey). */
export const PICTOGRAM_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red'
] as const

export const isPictogram = (icon: string | null | undefined): icon is string =>
  !!icon && icon.startsWith(PREFIX)

export function parsePictogram(icon: string): { name: string; color: string } | null {
  const [, name, color = 'default'] = icon.split(':')
  if (!name || !/^[a-z0-9-]{1,60}$/.test(name)) return null
  return {
    name,
    color: (PICTOGRAM_COLORS as readonly string[]).includes(color) ? color : 'default'
  }
}

export const pictogramIcon = (name: string, color: string): string => `${PREFIX}${name}:${color}`

/** The CSS colour of a pictogram colour. */
export const pictogramColor = (color: string): string =>
  color === 'default' ? 'var(--text-muted)' : `var(--nx-${color})`

const kebab = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

/** Shown first, before the others in alphabetical order: what pages are often about. */
const FIRST = [
  'file-text',
  'notebook',
  'book-open',
  'folder',
  'archive',
  'calendar',
  'calendar-days',
  'square-check',
  'list-checks',
  'clipboard-list',
  'star',
  'heart',
  'house',
  'briefcase',
  'users',
  'user',
  'flag',
  'lightbulb',
  'rocket',
  'target',
  'trophy',
  'award',
  'bell',
  'bookmark',
  'code',
  'database',
  'server',
  'cpu',
  'globe',
  'mail',
  'inbox',
  'map',
  'message-circle',
  'megaphone',
  'pencil',
  'pen-tool',
  'palette',
  'camera',
  'image',
  'video',
  'music',
  'phone',
  'chart-pie',
  'chart-bar',
  'chart-line',
  'search',
  'settings',
  'wrench',
  'hammer',
  'key',
  'lock',
  'shield',
  'zap',
  'sparkles',
  'sun',
  'moon',
  'cloud',
  'coffee',
  'gift',
  'graduation-cap',
  'school',
  'microscope',
  'flask-conical',
  'test-tube',
  'calculator',
  'wallet',
  'euro',
  'dollar-sign',
  'shopping-cart',
  'package',
  'truck',
  'plane',
  'car',
  'timer',
  'alarm-clock',
  'link',
  'paperclip',
  'tag',
  'layers',
  'layout-dashboard',
  'puzzle',
  'smile',
  'sticky-note',
  'newspaper',
  'headphones',
  'heart-pulse',
  'stethoscope',
  'activity'
]

let loading: Promise<Pictogram[]> | null = null
let byName: Map<string, IconNode> | null = null

/** Every pictogram, once (aliases of the same drawing left out); loaded on first use. */
export function loadPictograms(): Promise<Pictogram[]> {
  loading ??= import('lucide').then(({ icons }) => {
    const seen = new Set<string>()
    const list: Pictogram[] = []
    byName = new Map()
    for (const [key, node] of Object.entries(icons as Record<string, IconNode>)) {
      const name = kebab(key)
      byName.set(name, node)
      const drawing = JSON.stringify(node)
      if (seen.has(drawing)) continue
      seen.add(drawing)
      list.push({ name, node })
    }
    const rank = (name: string): number => {
      const i = FIRST.indexOf(name)
      return i < 0 ? FIRST.length : i
    }
    return list.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  })
  return loading
}

/** The drawing of a pictogram, once loaded (null until then, or for an unknown name). */
export const pictogramNode = (name: string): IconNode | null => byName?.get(name) ?? null

/** The pictograms whose name has the words searched (English, like Lucide's). */
export function searchPictograms(list: Pictogram[], query: string): Pictogram[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
  if (!words.length) return list
  return list
    .filter((p) => words.every((w) => p.name.split('-').some((part) => part.startsWith(w))))
    .sort((a, b) => Number(!a.name.startsWith(words[0])) - Number(!b.name.startsWith(words[0])))
}
