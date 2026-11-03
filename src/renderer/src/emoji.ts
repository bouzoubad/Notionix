import { language } from '../../shared/i18n'

/** An emoji with what finds it: its names in French and English, keywords, shortcodes. */
export interface EmojiEntry {
  emoji: string
  /** Name in the interface's language */
  label: string
  group: number
  order: number
  /** Its names in French and English, folded (no accents, lower case) */
  names: string[]
  /** Its keywords, folded */
  terms: string[]
  shortcodes: string[]
}

interface CompactEmoji {
  hexcode: string
  label: string
  unicode: string
  group?: number
  order?: number
  tags?: string[]
}

/** The groups of the picker, in order (emojibase's numbers), with their tab icon. */
export const EMOJI_GROUPS: { id: number; icon: string; label: string }[] = [
  { id: 0, icon: '😀', label: 'Smileys et émotions' },
  { id: 1, icon: '🧑', label: 'Personnes' },
  { id: 3, icon: '🐻', label: 'Animaux et nature' },
  { id: 4, icon: '🍔', label: 'Nourriture et boissons' },
  { id: 5, icon: '✈️', label: 'Voyages et lieux' },
  { id: 6, icon: '⚽', label: 'Activités' },
  { id: 7, icon: '💡', label: 'Objets' },
  { id: 8, icon: '🔣', label: 'Symboles' },
  { id: 9, icon: '🚩', label: 'Drapeaux' }
]

export const fold = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').toLowerCase()

let loading: Promise<EmojiEntry[]> | null = null

/** Every emoji (loaded on first use: the data is large). */
export function loadEmojis(): Promise<EmojiEntry[]> {
  loading ??= Promise.all([
    import('emojibase-data/fr/compact.json'),
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/emojibase.json')
  ]).then(([fr, en, codes]) => {
    const english = new Map((en.default as CompactEmoji[]).map((e) => [e.hexcode, e] as const))
    const shortcodes = codes.default as Record<string, string | string[]>
    const french = language() === 'fr'
    return (fr.default as CompactEmoji[])
      .filter((e) => e.group !== undefined && e.group !== 2)
      .map((e) => {
        const en = english.get(e.hexcode)
        const sc = shortcodes[e.hexcode]
        const codesOf = sc === undefined ? [] : Array.isArray(sc) ? sc : [sc]
        return {
          emoji: e.unicode,
          label: french ? e.label : (en?.label ?? e.label),
          group: e.group!,
          order: e.order ?? 0,
          names: [e.label, en?.label ?? ''].filter(Boolean).map(fold),
          terms: [...(e.tags ?? []), ...(en?.tags ?? [])].map(fold),
          shortcodes: codesOf
        }
      })
      .sort((a, b) => a.order - b.order)
  })
  return loading
}

/** What people mean most often by a word, first whatever the data's order (« coeur » is ❤️). */
const USUAL: Record<string, string> = {
  coeur: '❤️',
  heart: '❤️',
  rire: '😂',
  lol: '😂',
  sourire: '😄',
  pouce: '👍',
  ok: '👌',
  bravo: '👏',
  feu: '🔥',
  fete: '🎉',
  merci: '🙏',
  triste: '😢',
  colere: '😠',
  clin: '😉',
  amour: '😍',
  bisou: '😘',
  cool: '😎',
  idee: '💡',
  attention: '⚠️',
  valide: '✅',
  oui: '✅',
  non: '❌',
  croix: '❌',
  etoile: '⭐',
  cafe: '☕',
  fusee: '🚀'
}

/**
 * The emojis a search finds, best first: a shortcode (":heart"), a name, the
 * start of a word of their names, then of their keywords, then anywhere.
 */
export function searchEmojis(list: EmojiEntry[], query: string, limit = 60): EmojiEntry[] {
  const q = fold(query.trim()).replace(/^:+|:+$/g, '')
  if (!q) return list.slice(0, limit)
  const scored: [number, EmojiEntry][] = []
  const startsAWord = (text: string): boolean => text.split(/[\s-]+/).some((w) => w.startsWith(q))
  for (const e of list) {
    // The emoji named so first (« fusée » is the rocket; the astronaut only has it as a keyword).
    const score =
      USUAL[q] === e.emoji
        ? -1
        : e.shortcodes.includes(q)
          ? 0
          : e.names.includes(q)
            ? 1
            : e.names.some((n) => n.startsWith(q))
              ? 2
              : e.shortcodes.some((c) => c.startsWith(q))
                ? 3
                : e.terms.includes(q)
                  ? 4
                  : e.names.some(startsAWord)
                    ? 5
                    : e.terms.some(startsAWord)
                      ? 6
                      : [...e.names, ...e.terms].some((t) => t.includes(q))
                        ? 7
                        : 9
    if (score < 9) scored.push([score, e])
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].order - b[1].order)
    .slice(0, limit)
    .map(([, e]) => e)
}

const RECENT_KEY = 'notionix-recent-emojis'

/** The emojis used lately on this device, latest first. */
export function recentEmojis(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? saved.filter((e) => typeof e === 'string').slice(0, 24) : []
  } catch {
    return []
  }
}

export function rememberEmoji(emoji: string): void {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([emoji, ...recentEmojis().filter((e) => e !== emoji)].slice(0, 24))
    )
  } catch {
    // Only a convenience.
  }
}
