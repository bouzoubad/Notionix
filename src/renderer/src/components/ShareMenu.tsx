import { useEffect, useState } from 'react'
import type { PageAccess, PageShare, PageSummary } from '../../../shared/types'
import { useStore } from '../store'
import { platform } from '../platform'
import { Popover } from '../database/Popover'

const LEVEL_LABELS: Record<PageShare['level'], string> = {
  full: 'Accès complet',
  edit: 'Peut modifier',
  comment: 'Peut commenter',
  read: 'Peut lire'
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Who sees a page: general access, people it is shared with, teamspace. */
export function ShareMenu({
  page,
  onClose
}: {
  page: PageSummary
  onClose: () => void
}): React.JSX.Element {
  const people = useStore((s) => s.people)
  const load = useStore((s) => s.load)
  const showNotice = useStore((s) => s.showNotice)
  const [shares, setShares] = useState<PageShare[] | null>(null)
  const [invite, setInvite] = useState('')
  const [level, setLevel] = useState<PageShare['level']>('edit')
  const manage = page.level === 'full'
  const me = platform().session?.user.id
  const top = page.parentId === null

  useEffect(() => {
    let cancelled = false
    window.api.pages.shares(page.id).then((s) => !cancelled && setShares(s))
    return () => {
      cancelled = true
    }
  }, [page.id])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      setShares(await window.api.pages.shares(page.id))
      await load()
    } catch (e) {
      showNotice(`Partage impossible : ${message(e)}`)
    }
  }
  const nameOf = (id: string): string => {
    const p = people.find((x) => x.id === id)
    return p ? `${p.name}${p.id === me ? ' (vous)' : ''}` : 'Compte supprimé'
  }
  const candidates = people.filter(
    (p) => !p.disabled && p.id !== me && !shares?.some((s) => s.userId === p.id)
  )
  const general: PageAccess = top && page.access === 'inherit' ? 'workspace' : page.access

  return (
    <Popover onClose={onClose} align="right" className="share-menu">
      <h5>Accès général</h5>
      <select
        disabled={!manage}
        value={general}
        onChange={(e) =>
          void run(() => window.api.pages.setAccess(page.id, e.target.value as PageAccess))
        }
      >
        {!top && <option value="inherit">Comme la page parente</option>}
        <option value="workspace">Tous les membres de l’espace</option>
        <option value="restricted">Restreint : seulement les personnes invitées</option>
      </select>
      <p className="share-hint">
        {general === 'restricted'
          ? 'Visible par son créateur et les personnes ci-dessous.'
          : general === 'workspace'
            ? 'Visible par tous les membres (pas les invités), en plus des personnes ci-dessous.'
            : 'Mêmes accès que la page parente, plus les personnes ci-dessous.'}
      </p>

      <h5>Personnes invitées</h5>
      {shares === null ? (
        <p className="share-hint">Chargement…</p>
      ) : shares.length === 0 ? (
        <p className="share-hint">Personne pour l’instant.</p>
      ) : (
        <ul className="share-list">
          {shares.map((s) => (
            <li key={s.userId}>
              <span>{nameOf(s.userId)}</span>
              <select
                disabled={!manage}
                value={s.level}
                onChange={(e) =>
                  void run(() =>
                    window.api.pages.setShare(
                      page.id,
                      s.userId,
                      e.target.value as PageShare['level']
                    )
                  )
                }
              >
                {Object.entries(LEVEL_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              {manage && (
                <button
                  title="Retirer"
                  onClick={() => void run(() => window.api.pages.setShare(page.id, s.userId, null))}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && candidates.length > 0 && (
        <div className="share-invite">
          <select value={invite} onChange={(e) => setInvite(e.target.value)}>
            <option value="">Inviter une personne…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.email})
              </option>
            ))}
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value as PageShare['level'])}>
            {Object.entries(LEVEL_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <button
            disabled={!invite}
            onClick={() =>
              void run(async () => {
                await window.api.pages.setShare(page.id, invite, level)
                setInvite('')
              })
            }
          >
            Inviter
          </button>
        </div>
      )}

      <h5>Publier sur le web</h5>
      <label className="share-space publish">
        <input
          type="checkbox"
          disabled={!manage}
          checked={page.publicToken !== null}
          onChange={(e) => void run(() => window.api.pages.publish(page.id, e.target.checked))}
        />
        Lien public en lecture seule (la page et ses sous-pages)
      </label>
      {page.publicToken && (
        <div className="share-public-link">
          <input
            readOnly
            value={`${location.origin}/p/${page.publicToken}`}
            onFocus={(e) => e.target.select()}
          />
          <a href={`/p/${page.publicToken}`} target="_blank" rel="noreferrer">
            Ouvrir
          </a>
        </div>
      )}
      {top && manage && (
        <label className="share-space">
          <input
            type="checkbox"
            checked={page.isSpace}
            onChange={(e) => void run(() => window.api.pages.setSpace(page.id, e.target.checked))}
          />
          Afficher comme espace d’équipe dans la barre latérale
        </label>
      )}
      {!manage && (
        <p className="share-hint">Seules les personnes ayant un accès complet gèrent le partage.</p>
      )}
    </Popover>
  )
}
