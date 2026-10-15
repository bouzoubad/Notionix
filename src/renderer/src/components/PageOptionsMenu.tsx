import { useEffect, useState } from 'react'
import type { PageOptions, PageStats, PageSummary } from '../../../shared/types'
import { atLeast } from '../../../shared/types'
import { pageUrl, useStore } from '../store'
import { copyText } from '../clipboard'
import { Popover } from '../database/Popover'
import { locale, t } from '../../../shared/i18n'

const FONTS: { value: NonNullable<PageOptions['font']>; label: string; sample: string }[] = [
  { value: 'default', label: t('Par défaut'), sample: 'Ag' },
  { value: 'serif', label: 'Serif', sample: 'Ag' },
  { value: 'mono', label: 'Mono', sample: 'Ag' }
]

/** Page layout options and lock, plus the page's actions. */
export function PageOptionsMenu({
  page,
  onClose
}: {
  page: PageSummary
  onClose: () => void
}): React.JSX.Element {
  const patch = useStore((s) => s.patch)
  const exportPage = useStore((s) => s.exportPage)
  const duplicate = useStore((s) => s.duplicate)
  const trash = useStore((s) => s.trash)
  const canEdit = atLeast(page.level, 'edit')
  const showNotice = useStore((s) => s.showNotice)
  const exportAs = async (format: 'html' | 'pdf'): Promise<void> => {
    try {
      // The menu closes first so that it is not in the PDF.
      await new Promise((r) => setTimeout(r, 50))
      const result =
        format === 'html'
          ? await window.api.transfer.exportHtml(page.id)
          : await window.api.transfer.exportPdf(page.id)
      if (result) showNotice(t('Exporté : {path}', { path: result.path }))
    } catch (e) {
      showNotice(
        t('Export impossible : {error}', { error: e instanceof Error ? e.message : String(e) })
      )
    }
  }
  const options = page.options
  const set = (next: Partial<PageOptions>): void =>
    void patch(page.id, { options: { ...options, ...next } })

  return (
    <Popover onClose={onClose} align="right" className="page-options">
      {page.kind === 'page' && (
        <div className="font-choice">
          {FONTS.map((f) => (
            <button
              key={f.value}
              disabled={!canEdit || options.locked}
              className={(options.font ?? 'default') === f.value ? 'active' : ''}
              onClick={() => set({ font: f.value })}
            >
              <span className={`font-sample font-${f.value}`}>{f.sample}</span>
              {f.label}
            </button>
          ))}
        </div>
      )}
      <label className="option-row">
        {t('Petit texte')}
        <input
          type="checkbox"
          disabled={!canEdit || options.locked}
          checked={!!options.smallText}
          onChange={(e) => set({ smallText: e.target.checked })}
        />
      </label>
      <label className="option-row">
        {t('Pleine largeur')}
        <input
          type="checkbox"
          disabled={!canEdit || options.locked}
          checked={!!options.fullWidth}
          onChange={(e) => set({ fullWidth: e.target.checked })}
        />
      </label>
      <label className="option-row">
        {t('Verrouiller la page')}
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={!!options.locked}
          onChange={(e) => set({ locked: e.target.checked })}
        />
      </label>
      <label className="option-row">
        {t('Enregistrer comme modèle')}
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={!!options.template}
          onChange={(e) => set({ template: e.target.checked })}
        />
      </label>
      <hr />
      <button
        onClick={() => {
          onClose()
          void copyText(pageUrl(page.id)).then((ok) =>
            showNotice(
              ok ? t('Lien de la page copié.') : t('Lien : {url}', { url: pageUrl(page.id) })
            )
          )
        }}
      >
        {t('Copier le lien')}
      </button>
      <button onClick={() => (onClose(), void patch(page.id, { favorite: !page.favorite }))}>
        {page.favorite ? t('Retirer des favoris') : t('Ajouter aux favoris')}
      </button>
      <button onClick={() => (onClose(), void duplicate(page.id))}>{t('Dupliquer')}</button>
      <button onClick={() => (onClose(), void exportPage(page.id))}>
        {t('Exporter en Markdown')}
      </button>
      <button onClick={() => (onClose(), void exportAs('html'))}>{t('Exporter en HTML')}</button>
      <button onClick={() => (onClose(), void exportAs('pdf'))}>{t('Exporter en PDF')}</button>
      {canEdit && (
        <button onClick={() => (onClose(), void trash(page.id))}>
          {t('Mettre à la corbeille')}
        </button>
      )}
      <hr />
      <ViewStats pageId={page.id} />
    </Popover>
  )
}

const when = (ms: number): string =>
  new Date(ms).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Openings of the page over the last four weeks, and who opened it lately. */
function ViewStats({ pageId }: { pageId: string }): React.JSX.Element {
  const people = useStore((s) => s.people)
  const [stats, setStats] = useState<PageStats | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.pages
      .stats(pageId)
      .then((s) => !cancelled && setStats(s))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pageId])
  if (!stats) return <div className="page-stats muted">{t('Statistiques…')}</div>
  const max = Math.max(1, ...stats.days)
  const name = (id: string): string => people.find((p) => p.id === id)?.name ?? t('Ancien compte')
  return (
    <div className="page-stats">
      <div className="page-stats-head">
        <strong>{stats.views}</strong> {stats.views > 1 ? t('vues') : t('vue')}
        {people.length > 0 && (
          <>
            {' · '}
            <strong>{stats.viewers}</strong> {stats.viewers > 1 ? t('personnes') : t('personne')}
          </>
        )}
      </div>
      <div className="page-stats-bars" title={t('Vues des 28 derniers jours')}>
        {stats.days.map((n, i) => (
          <span key={i} style={{ height: `${(n / max) * 100}%` }} title={`${n}`} />
        ))}
      </div>
      {people.length > 0 &&
        stats.recent.slice(0, 5).map((r) => (
          <div key={r.userId} className="page-stats-viewer">
            <span>{name(r.userId)}</span>
            <small>{when(r.at)}</small>
          </div>
        ))}
    </div>
  )
}
