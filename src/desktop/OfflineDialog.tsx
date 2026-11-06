import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorkspaceInfo } from '../shared/collab'
import { t } from '../shared/i18n'
import { PageIcon } from '../renderer/src/components/PageIcon'
import { formatSize, offlineStatusText } from '../renderer/src/offline'
import type { OfflineSync } from './offlineSync'
import type { Availability } from './offlinePlan'

/**
 * The copies of the team's pages on this computer: per workspace, kept (the
 * default) or online only, with the room they take; and keeping them up to
 * date now.
 */
export function OfflineDialog({
  sync,
  connected,
  onClose
}: {
  sync: OfflineSync
  /** Whether the server can be reached now */
  connected: boolean
  onClose: () => void
}): React.JSX.Element {
  const status = useSyncExternalStore(sync.subscribe, sync.status)
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  useEffect(() => {
    let cancelled = false
    void sync.workspaces().then((list) => !cancelled && setWorkspaces(list))
    return () => {
      cancelled = true
    }
  }, [sync])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog offline-dialog"
        role="dialog"
        aria-label={t('Hors ligne')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>{t('Hors ligne')}</h3>
        <p className="offline-dialog-status" role="status">
          {offlineStatusText(status, connected)}
        </p>
        <p>
          {t(
            'Les pages gardées sur cet ordinateur s’ouvrent sans réseau : leur texte, leur titre et leur place s’y modifient ; les bases et commentaires de l’équipe s’y lisent. Tout part sur le serveur au retour du réseau.'
          )}
        </p>
        <ul className="offline-workspaces">
          {workspaces.map((w) => {
            const usage = sync.usage(w.id)
            return (
              <li key={w.id}>
                <span className="offline-workspace-name">
                  <PageIcon icon={w.icon || '🏢'} /> {w.name}
                </span>
                <select
                  aria-label={t('Hors ligne : {name}', { name: w.name })}
                  value={sync.workspaceChoice(w.id)}
                  onChange={(e) => sync.setWorkspace(w.id, e.target.value as Availability)}
                >
                  <option value="keep">{t('Garder sur cet ordinateur')}</option>
                  <option value="online">{t('En ligne uniquement')}</option>
                </select>
                <small className="offline-workspace-usage">
                  {t('{n} pages gardées · {size}', {
                    n: usage.pages,
                    size: formatSize(usage.bytes)
                  })}
                  {usage.ownChoices > 0 &&
                    ` · ${t('{n} pages réglées à part', { n: usage.ownChoices })}`}
                </small>
              </li>
            )
          })}
        </ul>
        <p className="offline-dialog-note">
          {t(
            'Vos pages privées, vos favoris et les pages ouvertes récemment sont toujours gardés. Les copies sont dans le dossier de l’app (Bibliothèque > Application Support > Notionix) et sont effacées à la déconnexion ; FileVault les protège si l’ordinateur est perdu.'
          )}
        </p>
        <div className="offline-dialog-actions">
          <button disabled={!connected || status.running} onClick={() => void sync.run()}>
            {t('Synchroniser maintenant')}
          </button>
          <button className="primary" onClick={onClose}>
            {t('Fermer')}
          </button>
        </div>
      </div>
    </div>
  )
}
