/**
 * Interface language. Texts are written in French in the code and wrapped in
 * t('…'): the French text is its own key, translated through the dictionary
 * of the language chosen (English for now). A missing translation shows the
 * French text. Variables are written {name}: t('{n} page(s)', { n: 3 }).
 *
 * The language is per device (localStorage), read once when the app starts:
 * changing it reloads the app.
 */
import en from './locales/en'

export type Language = 'fr' | 'en'
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' }
]
const KEY = 'language'
const DICTIONARIES: Record<Exclude<Language, 'fr'>, Record<string, string>> = { en }

function stored(): Language {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    if (v === 'fr' || v === 'en') return v
  } catch {
    // no storage (server, private mode): French
  }
  return 'fr'
}

let current: Language = stored()

export const language = (): Language => current

/** Saves the choice; the caller reloads the app so that every text follows. */
export function setLanguage(next: Language): void {
  current = next
  try {
    globalThis.localStorage?.setItem(KEY, next)
  } catch {
    // kept for this session only
  }
}

export function t(source: string, vars?: Record<string, string | number>): string {
  const text = current === 'fr' ? source : (DICTIONARIES[current][source] ?? source)
  return vars
    ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
    : text
}

/**
 * A text whose translation depends on its use: the same French word can need
 * different English ones ("Moyenne": Average or Medium). The dictionary key
 * is "context::text"; French shows the text itself.
 */
export function tx(
  context: string,
  source: string,
  vars?: Record<string, string | number>
): string {
  if (current === 'fr') return t(source, vars)
  const key = `${context}::${source}`
  return t(key in DICTIONARIES[current] ? key : source, vars)
}

/**
 * Runs `fn` in a language, then comes back to the current one (the server:
 * data created for a person, such as default names, is in their language).
 */
export function inLanguage<T>(lang: Language, fn: () => T): T {
  const previous = current
  current = lang
  try {
    return fn()
  } finally {
    current = previous
  }
}

/** Locale for dates and numbers. */
export const locale = (): string => (current === 'en' ? 'en-US' : 'fr-FR')
