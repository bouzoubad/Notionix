import { olderVersion } from '../shared/changelog'
import { desktopVersion, type ClientSeen } from '../shared/clients'
import { locale, t } from '../shared/i18n'
import { clientLabel } from './clientLabel'

const when = (ms: number): string =>
  new Date(ms).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

/**
 * What a person used Notionix from lately (latest first), the desktop apps
 * older than the one the server offers marked « à mettre à jour ».
 */
export function ClientsSeen({
  clients,
  latest
}: {
  clients: ClientSeen[]
  /** Version of the desktop app the server offers, when known */
  latest: string | null
}): React.JSX.Element {
  if (clients.length === 0) return <span className="settings-note">—</span>
  return (
    <span className="clients-seen">
      {clients.map((c) => {
        const version = desktopVersion(c.client)
        const outdated = version !== null && latest !== null && olderVersion(version, latest)
        const update = version ? c.update : null
        // What the app said of its own update, when it is about a newer version.
        const progress =
          update?.status === 'ready' && update.version && olderVersion(version!, update.version)
            ? t('{version} prête, attend un redémarrage', { version: update.version })
            : update?.status === 'downloading' && update.version
              ? t('téléchargement de {version} ({percent} %)', {
                  version: update.version,
                  percent: update.percent ?? 0
                })
              : update?.status === 'error'
                ? t('échec de la mise à jour')
                : null
        return (
          <span
            key={c.client}
            className={`client-seen${outdated ? ' outdated' : ''}${update?.status === 'error' ? ' failed' : ''}`}
            title={[
              t('Utilisé le {when}', { when: when(c.seenAt) }),
              update?.message ? `${t('Erreur')} : ${update.message}` : '',
              update ? t('État de la mise à jour au {when}', { when: when(update.at) }) : ''
            ]
              .filter(Boolean)
              .join('\n')}
          >
            {clientLabel(c.client)}
            {progress ? (
              <small>{progress}</small>
            ) : (
              outdated && <small>{t('à mettre à jour')}</small>
            )}
          </span>
        )
      })}
    </span>
  )
}
