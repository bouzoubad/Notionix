import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import {
  EMOJI_GROUPS,
  loadEmojis,
  recentEmojis,
  rememberEmoji,
  searchEmojis,
  type EmojiEntry
} from '../emoji'

/**
 * Choosing an emoji: a search (French or English names, keywords,
 * shortcodes), the recent ones, and every emoji by group.
 */
export function EmojiPicker({
  onPick,
  autoFocus = true
}: {
  onPick: (emoji: string) => void
  autoFocus?: boolean
}): React.JSX.Element {
  const [all, setAll] = useState<EmojiEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<number | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    void loadEmojis().then((list) => !cancelled && setAll(list))
    return () => {
      cancelled = true
    }
  }, [])

  const recent = useMemo(() => recentEmojis(), [])
  const found = useMemo(
    () => (all && query.trim() ? searchEmojis(all, query, 120) : null),
    [all, query]
  )
  const pick = (emoji: string): void => {
    rememberEmoji(emoji)
    onPick(emoji)
  }
  const cell = (emoji: string, label?: string): React.JSX.Element => (
    <button
      key={emoji}
      type="button"
      title={label}
      aria-label={label ?? emoji}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(emoji)}
    >
      {emoji}
    </button>
  )

  return (
    <div className="emoji-picker" onMouseDown={(e) => e.stopPropagation()}>
      <input
        className="emoji-search"
        autoFocus={autoFocus}
        placeholder={t('Rechercher un émoji (cœur, fusée, rocket…)')}
        aria-label={t('Rechercher un émoji')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && found?.[0]) {
            e.preventDefault()
            pick(found[0].emoji)
          }
        }}
      />
      {!found && (
        <div className="emoji-groups" role="tablist">
          {EMOJI_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={group === g.id}
              title={t(g.label)}
              className={group === g.id ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setGroup(g.id)
                grid.current
                  ?.querySelector(`[data-group="${g.id}"]`)
                  ?.scrollIntoView({ block: 'start' })
              }}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-scroll" ref={grid}>
        {!all ? (
          <p className="emoji-note">{t('Chargement…')}</p>
        ) : found ? (
          found.length ? (
            <div className="emoji-grid">{found.map((e) => cell(e.emoji, e.label))}</div>
          ) : (
            <p className="emoji-note">{t('Aucun émoji trouvé.')}</p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <p className="emoji-group-title">{t('Récents')}</p>
                <div className="emoji-grid">{recent.map((e) => cell(e))}</div>
              </>
            )}
            {EMOJI_GROUPS.map((g) => (
              <div key={g.id} data-group={g.id}>
                <p className="emoji-group-title">{t(g.label)}</p>
                <div className="emoji-grid">
                  {all.filter((e) => e.group === g.id).map((e) => cell(e.emoji, e.label))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
