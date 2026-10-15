import { useStore } from '../store'
import { PageIcon } from './PageIcon'

/** Pages open in tabs, shown when there is more than one. */
export function TabBar(): React.JSX.Element | null {
  const tabs = useStore((s) => s.tabs)
  const tab = useStore((s) => s.tab)
  const pages = useStore((s) => s.pages)
  const selectTab = useStore((s) => s.selectTab)
  const closeTab = useStore((s) => s.closeTab)
  const newTab = useStore((s) => s.newTab)
  if (tabs.length < 2) return null
  return (
    <div className="tab-bar" role="tablist" aria-label="Onglets">
      {tabs.map((id, i) => {
        const page = pages.find((p) => p.id === id)
        const title = id === null ? 'Nouvel onglet' : page?.title || 'Sans titre'
        return (
          <div
            key={i}
            role="tab"
            aria-selected={i === tab}
            tabIndex={i === tab ? 0 : -1}
            className={i === tab ? 'page-tab active' : 'page-tab'}
            title={title}
            onClick={() => selectTab(i)}
            onAuxClick={(e) => e.button === 1 && closeTab(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                selectTab(next)
                requestAnimationFrame(() =>
                  document.querySelectorAll<HTMLElement>('.page-tab')[next]?.focus()
                )
              } else if (e.key === 'Delete') closeTab(i)
            }}
          >
            <span className="page-tab-icon">
              <PageIcon icon={page?.icon} fallback="📄" />
            </span>
            <span className="page-tab-title">{title}</span>
            <button
              className="page-tab-close"
              aria-label={`Fermer l’onglet ${title}`}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(i)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button className="page-tab-new" aria-label="Nouvel onglet" onClick={() => newTab()}>
        +
      </button>
    </div>
  )
}
