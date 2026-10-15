import { useStore } from '../store'
import { PageIcon } from './PageIcon'
import { t } from '../../../shared/i18n'

export function TrashDialog(): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const setOpen = useStore((s) => s.setTrashOpen)
  const restore = useStore((s) => s.restore)
  const deleteForever = useStore((s) => s.deleteForever)
  const ids = new Set(pages.map((p) => p.id))
  // Show only the roots of trashed subtrees: pages whose parent is not trashed with them.
  const trashed = pages.filter((p) => {
    if (!p.trashedAt) return false
    const parent = p.parentId ? pages.find((x) => x.id === p.parentId) : undefined
    return !(parent && ids.has(parent.id) && parent.trashedAt === p.trashedAt)
  })
  return (
    <div className="overlay" onMouseDown={() => setOpen(false)}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('Corbeille')}</h3>
        <p className="trash-note">
          {t('Les pages sont supprimées définitivement 30 jours après leur mise à la corbeille.')}
        </p>
        <div className="results">
          {trashed.map((p) => (
            <div key={p.id} className="hit trash-item">
              <span>
                <PageIcon icon={p.icon} fallback="📄" /> {p.title || t('Sans titre')}
              </span>
              <span>
                <button onClick={() => void restore(p.id)}>{t('Restaurer')}</button>
                <button
                  onClick={() => {
                    if (confirm(t('Supprimer définitivement cette page et ses sous-pages ?')))
                      void deleteForever(p.id)
                  }}
                >
                  {t('Supprimer')}
                </button>
              </span>
            </div>
          ))}
          {trashed.length === 0 && <p className="empty">{t('La corbeille est vide.')}</p>}
        </div>
      </div>
    </div>
  )
}
