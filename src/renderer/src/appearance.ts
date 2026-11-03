import {
  appearanceCss,
  parseAppearance,
  DEFAULT_APPEARANCE,
  type Appearance,
  type AppearanceKey
} from '../../shared/appearance'
import { platform } from './platform'

const KEY = 'notionix-appearance'
const STYLE_ID = 'nx-appearance'

/** The colours last chosen on this device (shown at once, before the server answers). */
export function storedAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(KEY)
    return saved ? parseAppearance(JSON.parse(saved)) : DEFAULT_APPEARANCE
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** Shows these colours (a <style> after the app's own), and keeps them on this device. */
export function applyAppearance(appearance: Appearance): void {
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = appearanceCss(appearance)
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance))
  } catch {
    // Shown for now; the account keeps them when there is one.
  }
}

/** Chosen in Apparence: shown, kept here, and in the person's account when there is one. */
export async function saveAppearance(appearance: Appearance): Promise<void> {
  applyAppearance(appearance)
  await platform().appearance?.save(appearance)
}

/** The account's colours (another device may have changed them), once signed in. */
export async function loadAccountAppearance(): Promise<void> {
  const saved = await platform()
    .appearance?.load()
    .catch(() => null)
  if (saved) applyAppearance(saved)
}

/** What the elements without a colour of their own show instead. */
const FALLBACK: Partial<Record<AppearanceKey, AppearanceKey>> = {
  heading: 'text',
  link: 'text',
  quote: 'text',
  'code-block-bg': 'bg-sidebar'
}

const rgb = (value: string): [number, number, number, number] | null => {
  const m = /rgba?\(([^)]+)\)/.exec(value)
  if (!m) return null
  const parts = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
}
const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0')

/** The colour an element shows now (#rrggbb), as the colour picker needs it. */
export function shownColor(key: AppearanceKey): string {
  const probe = document.createElement('span')
  const fallback = FALLBACK[key]
  probe.style.color = fallback ? `var(--${key}, var(--${fallback}))` : `var(--${key})`
  const page = document.createElement('span')
  page.style.color = 'var(--bg)'
  document.body.append(probe, page)
  const color = rgb(getComputedStyle(probe).color)
  const under = rgb(getComputedStyle(page).color) ?? [255, 255, 255, 1]
  probe.remove()
  page.remove()
  if (!color) return '#000000'
  // A see-through colour, as it shows over the page.
  const [r, g, b, a] = color
  const mix = (c: number, u: number): number => c * a + u * (1 - a)
  return `#${hex(mix(r, under[0]))}${hex(mix(g, under[1]))}${hex(mix(b, under[2]))}`
}
