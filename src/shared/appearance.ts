/**
 * The colours of the app, chosen per person (Apparence): a theme (a set of
 * colours for the light and the dark mode), and the person's own colour for
 * any element, per mode, over it. Turned into CSS custom properties.
 */

/** What a person can colour, as the CSS custom property it sets (`--<key>`). */
export const APPEARANCE_KEYS = [
  'bg',
  'bg-sidebar',
  'text',
  'text-muted',
  'heading',
  'link',
  'accent',
  'code-text',
  'code-bg',
  'code-block-bg',
  'quote'
] as const
export type AppearanceKey = (typeof APPEARANCE_KEYS)[number]

export type Palette = Partial<Record<AppearanceKey, string>>
export type ColorMode = 'light' | 'dark'

export interface Appearance {
  /** Id of a theme of THEMES */
  theme: string
  /** The person's own colours over the theme (#rrggbb), per mode */
  custom: Record<ColorMode, Palette>
}

/** Element names, in French (translated where shown). */
export const APPEARANCE_LABELS: Record<AppearanceKey, string> = {
  bg: 'Fond des pages',
  'bg-sidebar': 'Fond de la barre latérale',
  text: 'Texte',
  'text-muted': 'Texte secondaire',
  heading: 'Titres',
  link: 'Liens',
  accent: 'Couleur d’accent (boutons, sélection)',
  'code-text': 'Code dans le texte',
  'code-bg': 'Fond du code dans le texte',
  'code-block-bg': 'Fond des blocs de code',
  quote: 'Barre des citations'
}

/** Colours a theme sets beyond the ones people choose (borders, hover…); trusted values. */
type ThemeColors = Palette & Partial<Record<'border' | 'bg-hover' | 'bg-active', string>>

export interface Theme {
  id: string
  /** In French (translated where shown) */
  name: string
  light: ThemeColors
  dark: ThemeColors
}

/** The themes offered, the first being the default. */
export const THEMES: Theme[] = [
  // The app's own colours (main.css): code in red, as in Notion.
  { id: 'notionix', name: 'Notionix', light: {}, dark: {} },
  {
    id: 'classique',
    name: 'Classique (code sans couleur)',
    light: { 'code-text': 'inherit' },
    dark: { 'code-text': 'inherit' }
  },
  {
    id: 'contraste',
    name: 'Contraste élevé',
    light: {
      bg: '#ffffff',
      'bg-sidebar': '#f2f2f2',
      text: '#000000',
      'text-muted': '#3d3d3d',
      border: 'rgba(0, 0, 0, 0.35)',
      link: '#0047b3',
      accent: '#0047b3',
      'code-text': '#b00020',
      'code-bg': '#ebebeb',
      'code-block-bg': '#f2f2f2',
      quote: '#000000'
    },
    dark: {
      bg: '#000000',
      'bg-sidebar': '#0d0d0d',
      text: '#ffffff',
      'text-muted': '#cccccc',
      border: 'rgba(255, 255, 255, 0.4)',
      link: '#8ab4ff',
      accent: '#4d9fff',
      'code-text': '#ff8a80',
      'code-bg': '#222222',
      'code-block-bg': '#141414',
      quote: '#ffffff'
    }
  },
  {
    id: 'sepia',
    name: 'Sépia',
    light: {
      bg: '#fbf6ec',
      'bg-sidebar': '#f3ecdd',
      text: '#433422',
      'text-muted': '#8a7a63',
      border: 'rgba(67, 52, 34, 0.15)',
      'bg-hover': 'rgba(67, 52, 34, 0.08)',
      link: '#8a4b16',
      accent: '#a0632b',
      'code-text': '#b5462f',
      'code-bg': '#efe4cf',
      'code-block-bg': '#f3ead6',
      quote: '#a0632b'
    },
    dark: {
      bg: '#1e1a15',
      'bg-sidebar': '#26211a',
      text: '#e8dcc6',
      'text-muted': '#a3967f',
      border: 'rgba(232, 220, 198, 0.14)',
      'bg-hover': 'rgba(232, 220, 198, 0.07)',
      link: '#e0b07a',
      accent: '#d49a5a',
      'code-text': '#ef8a6a',
      'code-bg': '#332b21',
      'code-block-bg': '#2a241c',
      quote: '#d49a5a'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    light: {
      bg: '#eceff4',
      'bg-sidebar': '#e5e9f0',
      text: '#2e3440',
      'text-muted': '#4c566a',
      border: 'rgba(46, 52, 64, 0.14)',
      link: '#5e81ac',
      accent: '#5e81ac',
      'code-text': '#bf616a',
      'code-bg': '#d8dee9',
      'code-block-bg': '#e5e9f0',
      quote: '#81a1c1'
    },
    dark: {
      bg: '#2e3440',
      'bg-sidebar': '#3b4252',
      text: '#eceff4',
      'text-muted': '#a3abb9',
      border: 'rgba(236, 239, 244, 0.12)',
      'bg-hover': 'rgba(236, 239, 244, 0.07)',
      link: '#88c0d0',
      accent: '#88c0d0',
      'code-text': '#e5838b',
      'code-bg': '#434c5e',
      'code-block-bg': '#3b4252',
      quote: '#81a1c1'
    }
  },
  {
    id: 'solarized',
    name: 'Solarized',
    light: {
      bg: '#fdf6e3',
      'bg-sidebar': '#eee8d5',
      text: '#586e75',
      'text-muted': '#93a1a1',
      heading: '#073642',
      border: 'rgba(88, 110, 117, 0.18)',
      link: '#268bd2',
      accent: '#268bd2',
      'code-text': '#dc322f',
      'code-bg': '#eee8d5',
      'code-block-bg': '#eee8d5',
      quote: '#b58900'
    },
    dark: {
      bg: '#002b36',
      'bg-sidebar': '#073642',
      text: '#93a1a1',
      'text-muted': '#657b83',
      heading: '#eee8d5',
      border: 'rgba(147, 161, 161, 0.18)',
      'bg-hover': 'rgba(147, 161, 161, 0.08)',
      link: '#2aa198',
      accent: '#268bd2',
      'code-text': '#ef5f5c',
      'code-bg': '#073642',
      'code-block-bg': '#073642',
      quote: '#b58900'
    }
  }
]

export const DEFAULT_APPEARANCE: Appearance = { theme: 'notionix', custom: { light: {}, dark: {} } }

const HEX = /^#[0-9a-f]{6}$/i

/** What is stored or sent, made safe: a known theme, colours as #rrggbb only. */
export function parseAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const theme =
    typeof r.theme === 'string' && THEMES.some((t) => t.id === r.theme) ? r.theme : 'notionix'
  const custom = (r.custom && typeof r.custom === 'object' ? r.custom : {}) as Record<
    string,
    unknown
  >
  const palette = (value: unknown): Palette => {
    const out: Palette = {}
    if (!value || typeof value !== 'object') return out
    for (const key of APPEARANCE_KEYS) {
      const color = (value as Record<string, unknown>)[key]
      if (typeof color === 'string' && HEX.test(color)) out[key] = color.toLowerCase()
    }
    return out
  }
  return { theme, custom: { light: palette(custom.light), dark: palette(custom.dark) } }
}

/** The CSS of an appearance: the theme's colours and the person's, for each mode. */
export function appearanceCss(appearance: Appearance): string {
  const theme = THEMES.find((t) => t.id === appearance.theme) ?? THEMES[0]
  const block = (mode: ColorMode): string =>
    Object.entries({ ...theme[mode], ...appearance.custom[mode] })
      .map(([key, value]) => `--${key}: ${value};`)
      .join(' ')
  const light = block('light')
  const dark = block('dark')
  return [
    light && `:root, :root[data-theme='light'] { ${light} }`,
    dark && `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { ${dark} } }`,
    dark && `:root[data-theme='dark'] { ${dark} }`
  ]
    .filter(Boolean)
    .join('\n')
}
