import { useState } from 'react'
import { PageIcon } from './PageIcon'
import type { PageSummary } from '../../../shared/types'
import { ancestorsOf, useStore } from '../store'
import { isLocalPage, platform, sessionFor } from '../platform'
import { ShareMenu } from './ShareMenu'
import { HistoryDialog } from './HistoryDialog'
import { PageOptionsMenu } from './PageOptionsMenu'
import { locale, t } from '../../../shared/i18n'
import { useOfflineStatus } from '../offline'

const keptWhen = (ms: number): string =>
  new Date(ms).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Breadcrumbs of a page, and its actions (sharing…), above its content. */
export function PageTopBar({
  page,
  title
}: {
  page: PageSummary
  /** The title as being typed, shown in the last crumb */
  title: string
}): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const open = useStore((s) => s.open)
  const patch = useStore((s) => s.patch)
  const [menu, setMenu] = useState<'share' | 'history' | 'options' | null>(null)
  const presence = useStore((s) => s.presence)
  // One avatar per person, even with several tabs open.
  const here = [
    ...new Map(presence.filter((p) => p.pageId === page.id).map((p) => [p.userId, p])).values()
  ]
  const commentsOpen = useStore((s) => s.comments.open)
  const openComments = useStore((s) => s.openComments)
  const closeComments = useStore((s) => s.closeComments)
  const crumbs = ancestorsOf(pages, page.id)
  // Sharing: pages of a server, not the private ones kept on this computer.
  const web = sessionFor(page.id) !== null
  const shared = page.access === 'restricted' || page.publicToken !== null
  // Without network: when this copy of the page was kept here.
  useOfflineStatus()
  const offline = !useStore((s) => s.connected) && platform().offline !== undefined
  const keptAt = offline ? (platform().offline?.keptAt(page.id) ?? null) : null

  return (
    <div className="breadcrumbs">
      {crumbs.map((c) => (
        <button key={c.id} onClick={() => open(c.id)}>
          <PageIcon icon={c.icon} /> {c.title || t('Sans titre')}
        </button>
      ))}
      {platform().session && isLocalPage(page.id) && (
        <span
          className="local-badge"
          title={t(
            'Écrite sans réseau : elle sera envoyée sur le serveur, en page privée, au retour du réseau.'
          )}
        >
          {t('À envoyer')}
        </span>
      )}
      {offline && keptAt !== null && (
        <span
          className="kept-badge"
          title={t('Copie gardée sur cet ordinateur, synchronisée le {date}', {
            date: keptWhen(keptAt)
          })}
        >
          {t('Copie du {date}', { date: keptWhen(keptAt) })}
        </span>
      )}
      {page.options.locked && (
        <span className="lock-badge" title={t('Page verrouillée')}>
          🔒
        </span>
      )}
      <span className="crumb-current">
        <PageIcon icon={page.icon} fallback={page.kind === 'database' ? '🗃️' : ''} />{' '}
        {title || t('Sans titre')}
      </span>
      <div className="topbar-actions">
        <Avatars people={here} />
        {page.kind === 'page' && (
          <button
            className={commentsOpen ? 'active' : ''}
            title={t('Commentaires')}
            onClick={() => (commentsOpen ? closeComments() : openComments())}
          >
            💬
          </button>
        )}
        {page.kind === 'page' && (
          <button title={t('Historique des versions')} onClick={() => setMenu('history')}>
            {t('Historique')}
          </button>
        )}
        {menu === 'history' && <HistoryDialog page={page} onClose={() => setMenu(null)} />}
        {web && (
          <span className="topbar-anchor">
            <button
              className={menu === 'share' ? 'active' : ''}
              onClick={() => setMenu(menu === 'share' ? null : 'share')}
            >
              {shared ? `🔒 ${t('Partager')}` : t('Partager')}
            </button>
            {menu === 'share' && <ShareMenu page={page} onClose={() => setMenu(null)} />}
          </span>
        )}
        <button
          className={page.favorite ? 'favorite-on' : ''}
          title={page.favorite ? t('Retirer des favoris') : t('Ajouter aux favoris')}
          aria-label={page.favorite ? t('Retirer des favoris') : t('Ajouter aux favoris')}
          aria-pressed={page.favorite}
          onClick={() => void patch(page.id, { favorite: !page.favorite })}
        >
          {page.favorite ? '★' : '☆'}
        </button>
        <span className="topbar-anchor">
          <button
            title={t('Options de la page')}
            className={menu === 'options' ? 'active' : ''}
            onClick={() => setMenu(menu === 'options' ? null : 'options')}
          >
            ⋯
          </button>
          {menu === 'options' && <PageOptionsMenu page={page} onClose={() => setMenu(null)} />}
        </span>
      </div>
    </div>
  )
}

/** Initials of the people on the page, in their caret color. */
export function Avatars({
  people,
  small = false
}: {
  people: { userId: string; name: string; color: string }[]
  small?: boolean
}): React.JSX.Element | null {
  if (people.length === 0) return null
  const initials = (name: string): string =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('')
  return (
    <span className={`avatars${small ? ' small' : ''}`}>
      {people.slice(0, 4).map((p) => (
        <span
          key={p.userId}
          className="avatar"
          style={{ background: p.color }}
          title={t('{name} est sur cette page', { name: p.name })}
        >
          {initials(p.name)}
        </span>
      ))}
      {people.length > 4 && <span className="avatar more">+{people.length - 4}</span>}
    </span>
  )
}
