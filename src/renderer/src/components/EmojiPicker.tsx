import { useEffect, useMemo, useRef, useState } from 'react'
import type { CustomEmoji } from '../../../shared/collab'
import { CUSTOM_EMOJI_NAME } from '../../../shared/collab'
import { t } from '../../../shared/i18n'
import {
  EMOJI_GROUPS,
  emojiTone,
  fold,
  inTone,
  loadEmojis,
  recentEmojis,
  rememberEmoji,
  searchEmojis,
  setEmojiTone,
  TONE_SAMPLES,
  type EmojiEntry
} from '../emoji'
import { customEmojis } from '../customEmojis'
import { displaySrc, platform } from '../platform'
import {
  loadPictograms,
  PICTOGRAM_COLORS,
  pictogramColor,
  pictogramIcon,
  searchPictograms,
  type Pictogram
} from '../pictograms'
import { PictogramIcon } from './PictogramIcon'

/** What was picked: an emoji, one of the team's, or a pictogram (page icons). */
export type EmojiChoice = { emoji: string } | { custom: CustomEmoji } | { icon: string }

const MAX_PICTOGRAMS = 420

/**
 * Choosing an emoji: a search (French or English names, keywords,
 * shortcodes), the skin tone, the team's own emojis (with a server), the
 * recent ones and every emoji by group; for page icons, pictograms too.
 */
export function EmojiPicker({
  onPick,
  autoFocus = true,
  withIcons = false
}: {
  onPick: (choice: EmojiChoice) => void
  autoFocus?: boolean
  /** Page icons: an « Icônes » tab of pictograms */
  withIcons?: boolean
}): React.JSX.Element {
  const [tab, setTab] = useState<'emojis' | 'icons'>('emojis')
  return (
    <div className="emoji-picker" onMouseDown={(e) => e.stopPropagation()}>
      {withIcons && (
        <div className="emoji-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'emojis'}
            className={tab === 'emojis' ? 'active' : ''}
            onClick={() => setTab('emojis')}
          >
            {t('Émojis')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'icons'}
            className={tab === 'icons' ? 'active' : ''}
            onClick={() => setTab('icons')}
          >
            {t('Icônes')}
          </button>
        </div>
      )}
      {tab === 'emojis' ? (
        <EmojiTab onPick={onPick} autoFocus={autoFocus} />
      ) : (
        <IconTab onPick={(icon) => onPick({ icon })} />
      )}
    </div>
  )
}

function EmojiTab({
  onPick,
  autoFocus
}: {
  onPick: (choice: EmojiChoice) => void
  autoFocus: boolean
}): React.JSX.Element {
  const [all, setAll] = useState<EmojiEntry[] | null>(null)
  const [team, setTeam] = useState<CustomEmoji[]>([])
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<number | null>(null)
  const [tone, setTone] = useState(emojiTone)
  const [choosingTone, setChoosingTone] = useState(false)
  const [adding, setAdding] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const teamEmojis = platform().emojis
  const me = platform().session?.user

  useEffect(() => {
    let cancelled = false
    void loadEmojis().then((list) => !cancelled && setAll(list))
    void customEmojis(true).then((list) => !cancelled && setTeam(list))
    return () => {
      cancelled = true
    }
  }, [])

  const recent = useMemo(() => recentEmojis(), [])
  const found = useMemo(
    () => (all && query.trim() ? searchEmojis(all, query, 120) : null),
    [all, query]
  )
  const teamFound = useMemo(() => {
    const q = fold(query.trim()).replace(/^:+|:+$/g, '')
    return q ? team.filter((e) => e.name.includes(q)) : team
  }, [team, query])

  const pick = (emoji: string): void => {
    rememberEmoji(emoji)
    onPick({ emoji })
  }
  const cell = (entry: EmojiEntry): React.JSX.Element => {
    const emoji = inTone(entry, tone)
    return (
      <button
        key={entry.emoji}
        type="button"
        title={entry.label}
        aria-label={entry.label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(emoji)}
      >
        {emoji}
      </button>
    )
  }
  const plain = (emoji: string): React.JSX.Element => (
    <button
      key={emoji}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(emoji)}
    >
      {emoji}
    </button>
  )
  const teamCell = (e: CustomEmoji): React.JSX.Element => (
    <span key={e.name} className="team-emoji">
      <button
        type="button"
        title={`:${e.name}:`}
        aria-label={`:${e.name}:`}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => onPick({ custom: e })}
      >
        <img className="custom-emoji" src={displaySrc(e.src)} alt="" />
      </button>
      {me && (me.role === 'admin' || e.createdBy === me.id) && (
        <button
          type="button"
          className="team-emoji-remove"
          title={t('Supprimer :{name}:', { name: e.name })}
          aria-label={t('Supprimer :{name}:', { name: e.name })}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => {
            if (!confirm(t('Supprimer l’émoji :{name}: pour toute l’équipe ?', { name: e.name })))
              return
            void teamEmojis
              ?.remove(e.name)
              .then(() => customEmojis(true))
              .then(setTeam)
          }}
        >
          ×
        </button>
      )}
    </span>
  )
  const teamSection = teamEmojis && (teamFound.length > 0 || (!query.trim() && me)) && (
    <>
      <p className="emoji-group-title">{t('Équipe')}</p>
      <div className="emoji-grid">
        {teamFound.map(teamCell)}
        {!query.trim() && me && me.role !== 'reader' && me.role !== 'guest' && (
          <button
            type="button"
            className="team-emoji-add"
            title={t('Ajouter un émoji pour l’équipe')}
            aria-label={t('Ajouter un émoji pour l’équipe')}
            onClick={() => setAdding(!adding)}
          >
            +
          </button>
        )}
      </div>
      {adding && (
        <AddTeamEmoji
          onAdded={(list) => {
            setTeam(list)
            setAdding(false)
          }}
        />
      )}
    </>
  )

  return (
    <>
      <div className="emoji-search-row">
        <input
          className="emoji-search"
          autoFocus={autoFocus}
          placeholder={t('Rechercher un émoji (cœur, fusée, rocket…)')}
          aria-label={t('Rechercher un émoji')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (teamFound[0] && query.trim()) onPick({ custom: teamFound[0] })
            else if (found?.[0]) pick(inTone(found[0], tone))
          }}
        />
        <span className="emoji-tone">
          <button
            type="button"
            title={t('Couleur de peau')}
            aria-label={t('Couleur de peau')}
            aria-expanded={choosingTone}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setChoosingTone(!choosingTone)}
          >
            {TONE_SAMPLES[tone]}
          </button>
          {choosingTone && (
            <span className="emoji-tones" role="radiogroup" aria-label={t('Couleur de peau')}>
              {TONE_SAMPLES.map((sample, i) => (
                <button
                  key={sample}
                  type="button"
                  role="radio"
                  aria-checked={tone === i}
                  className={tone === i ? 'active' : ''}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setTone(i)
                    setEmojiTone(i)
                    setChoosingTone(false)
                  }}
                >
                  {sample}
                </button>
              ))}
            </span>
          )}
        </span>
      </div>
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
        {teamSection}
        {!all ? (
          <p className="emoji-note">{t('Chargement…')}</p>
        ) : found ? (
          found.length ? (
            <div className="emoji-grid">{found.map(cell)}</div>
          ) : (
            !teamFound.length && <p className="emoji-note">{t('Aucun émoji trouvé.')}</p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <p className="emoji-group-title">{t('Récents')}</p>
                <div className="emoji-grid">{recent.map(plain)}</div>
              </>
            )}
            {EMOJI_GROUPS.map((g) => (
              <div key={g.id} data-group={g.id}>
                <p className="emoji-group-title">{t(g.label)}</p>
                <div className="emoji-grid">{all.filter((e) => e.group === g.id).map(cell)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

/** A new emoji for the team: a name and an image. */
function AddTeamEmoji({ onAdded }: { onAdded: (list: CustomEmoji[]) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const add = async (): Promise<void> => {
    const clean = name
      .trim()
      .toLowerCase()
      .replace(/^:+|:+$/g, '')
    if (!CUSTOM_EMOJI_NAME.test(clean))
      return setError(t('Nom : 2 à 32 lettres minuscules, chiffres, « _ » ou « - ».'))
    if (!file) return setError(t('Choisissez une image.'))
    setBusy(true)
    setError(null)
    try {
      await platform().emojis!.add(clean, file)
      onAdded(await customEmojis(true))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="team-emoji-form">
      <input
        placeholder={t('nom (ex. logo, bravo-equipe)')}
        aria-label={t('Nom de l’émoji')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label={t('Image de l’émoji')}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="button" className="primary" disabled={busy} onClick={() => void add()}>
        {busy ? t('Envoi…') : t('Ajouter')}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/** Pictograms (Lucide) in a colour, for page icons. */
function IconTab({ onPick }: { onPick: (icon: string) => void }): React.JSX.Element {
  const [all, setAll] = useState<Pictogram[] | null>(null)
  const [query, setQuery] = useState('')
  const [color, setColor] = useState<string>('default')
  useEffect(() => {
    let cancelled = false
    void loadPictograms().then((list) => !cancelled && setAll(list))
    return () => {
      cancelled = true
    }
  }, [])
  const shown = useMemo(
    () => (all ? searchPictograms(all, query).slice(0, MAX_PICTOGRAMS) : []),
    [all, query]
  )
  return (
    <>
      <input
        className="emoji-search"
        autoFocus
        placeholder={t('Rechercher une icône (en anglais : rocket, calendar…)')}
        aria-label={t('Rechercher une icône')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="pictogram-colors" role="radiogroup" aria-label={t('Couleur de l’icône')}>
        {PICTOGRAM_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            className={color === c ? 'active' : ''}
            style={{ background: pictogramColor(c) }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="emoji-scroll">
        {!all ? (
          <p className="emoji-note">{t('Chargement…')}</p>
        ) : shown.length ? (
          <div className="emoji-grid">
            {shown.map((p) => (
              <button
                key={p.name}
                type="button"
                title={p.name}
                aria-label={p.name}
                onClick={() => onPick(pictogramIcon(p.name, color))}
              >
                <PictogramIcon name={p.name} color={color} />
              </button>
            ))}
          </div>
        ) : (
          <p className="emoji-note">{t('Aucune icône trouvée.')}</p>
        )}
        {all && !query && all.length > MAX_PICTOGRAMS && (
          <p className="emoji-note">
            {t('{n} icônes : recherchez pour trouver les autres.', { n: all.length })}
          </p>
        )}
      </div>
    </>
  )
}
