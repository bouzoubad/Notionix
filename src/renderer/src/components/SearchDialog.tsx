import { useEffect, useRef, useState } from 'react'
import { PageIcon } from './PageIcon'
import type { SearchFilters, SearchHit } from '../../../shared/types'
import { recentPageIds, useStore } from '../store'
import { t } from '../../../shared/i18n'

const DAY = 24 * 60 * 60 * 1000
const EDITED: { label: string; days: number }[] = [
  { label: t('Aujourd’hui'), days: 1 },
  { label: t('7 derniers jours'), days: 7 },
  { label: t('30 derniers jours'), days: 30 },
  { label: t('Cette année'), days: 365 }
]

const mark = (html: string): string =>
  html
    .replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/&#60;mark&#62;/g, '<mark>')
    .replace(/&#60;\/mark&#62;/g, '</mark>')

export function SearchDialog(): React.JSX.Element {
  const setOpen = useStore((s) => s.setSearchOpen)
  const open = useStore((s) => s.open)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const [titleOnly, setTitleOnly] = useState(false)
  const [createdBy, setCreatedBy] = useState('')
  const [within, setWithin] = useState('')
  const [editedDays, setEditedDays] = useState(0)
  const [kind, setKind] = useState<'' | 'page' | 'database'>('')
  const seq = useRef(0)

  const pages = useStore((s) => s.pages)
  const people = useStore((s) => s.people)
  const currentId = useStore((s) => s.currentId)
  // "Inside": the top-level pages, and the page open now.
  const scopes = pages.filter(
    (p) => !p.trashedAt && p.kind !== 'synced' && (p.parentId === null || p.id === currentId)
  )
  // Without a query: the pages opened lately.
  const recent: SearchHit[] = recentPageIds()
    .map((id) => pages.find((p) => p.id === id && !p.trashedAt))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, title: p.title, icon: p.icon, snippet: '' }))
  useEffect(() => {
    const n = ++seq.current
    if (!q.trim()) return
    const filters: SearchFilters = {}
    if (titleOnly) filters.titleOnly = true
    if (createdBy) filters.createdBy = createdBy
    if (within) filters.within = within
    // Rounded to the hour so that the query stays the same while typing.
    if (editedDays)
      filters.editedAfter = Math.floor((Date.now() - editedDays * DAY) / 3600000) * 3600000
    if (kind) filters.kind = kind
    window.api.pages.search(q, filters).then((h) => {
      if (n !== seq.current) return
      setHits(h)
      setSel(0)
    })
  }, [q, titleOnly, createdBy, within, editedDays, kind])
  const filtered = titleOnly || !!createdBy || !!within || !!editedDays || !!kind

  const list = q.trim() ? hits : recent
  const go = (h?: SearchHit): void => {
    if (!h) return
    open(h.id)
    setOpen(false)
  }

  return (
    <div className="overlay" onMouseDown={() => setOpen(false)}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder={t('Rechercher dans les pages…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel(Math.min(sel + 1, list.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel(Math.max(sel - 1, 0))
            }
            if (e.key === 'Enter') go(list[sel])
          }}
        />
        <div className="search-filters">
          <button
            className={titleOnly ? 'active' : ''}
            aria-pressed={titleOnly}
            onClick={() => setTitleOnly(!titleOnly)}
          >
            {t('Titres seulement')}
          </button>
          {people.length > 0 && (
            <select
              aria-label={t('Créée par')}
              className={createdBy ? 'active' : ''}
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
            >
              <option value="">{t('Créée par…')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label={t('Dans')}
            className={within ? 'active' : ''}
            value={within}
            onChange={(e) => setWithin(e.target.value)}
          >
            <option value="">{t('Dans…')}</option>
            {scopes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentId ? t('Cette page : ') : ''}
                {p.title || t('Sans titre')}
              </option>
            ))}
          </select>
          <select
            aria-label={t('Modifiée')}
            className={editedDays ? 'active' : ''}
            value={editedDays}
            onChange={(e) => setEditedDays(Number(e.target.value))}
          >
            <option value={0}>{t('Modifiée…')}</option>
            {EDITED.map((d) => (
              <option key={d.days} value={d.days}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t('Type')}
            className={kind ? 'active' : ''}
            value={kind}
            onChange={(e) => setKind(e.target.value as '' | 'page' | 'database')}
          >
            <option value="">{t('Type…')}</option>
            <option value="page">{t('Pages')}</option>
            <option value="database">{t('Bases de données')}</option>
          </select>
          {filtered && (
            <button
              onClick={() => {
                setTitleOnly(false)
                setCreatedBy('')
                setWithin('')
                setEditedDays(0)
                setKind('')
              }}
            >
              {t('Effacer')}
            </button>
          )}
        </div>
        <div className="results">
          {!q.trim() && recent.length > 0 && <div className="menu-label">{t('Récents')}</div>}
          {list.map((h, i) => (
            <button
              key={h.id}
              className={i === sel ? 'hit active' : 'hit'}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(h)}
            >
              <span>
                <PageIcon icon={h.icon} fallback="📄" /> {h.title || t('Sans titre')}
              </span>
              <small dangerouslySetInnerHTML={{ __html: mark(h.snippet) }} />
            </button>
          ))}
          {q.trim() && hits.length === 0 && <p className="empty">{t('Aucun résultat')}</p>}
        </div>
      </div>
    </div>
  )
}
