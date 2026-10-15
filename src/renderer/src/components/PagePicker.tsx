import { useState } from 'react'
import { PageIcon } from './PageIcon'
import { useStore } from '../store'
import { t } from '../../../shared/i18n'

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Chooses a page by its title. */
export function PagePicker(): React.JSX.Element | null {
  const picker = useStore((s) => s.pagePicker)
  const close = useStore((s) => s.closePagePicker)
  const pages = useStore((s) => s.pages)
  const [query, setQuery] = useState('')
  if (!picker) return null
  const q = fold(query)
  const matches = pages
    .filter(
      (p) =>
        !p.trashedAt &&
        p.kind !== 'synced' &&
        (!picker.kind || p.kind === picker.kind) &&
        (!q || fold(p.title).includes(q))
    )
    .slice(0, 30)
  const pick = (id: string): void => {
    picker.onPick(id)
    close()
    setQuery('')
  }
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{picker.title}</h3>
        <input
          autoFocus
          placeholder={t('Rechercher une page…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter' && matches[0]) pick(matches[0].id)
          }}
        />
        <div className="results">
          {matches.map((p) => (
            <button key={p.id} className="hit" onClick={() => pick(p.id)}>
              <span>
                <PageIcon icon={p.icon} fallback={p.kind === 'database' ? '🗃️' : '📄'} />{' '}
                {p.title || t('Sans titre')}
              </span>
            </button>
          ))}
          {matches.length === 0 && <p className="inbox-empty">{t('Aucune page.')}</p>}
        </div>
      </div>
    </div>
  )
}
