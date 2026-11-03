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
        return (
          <span
            key={c.client}
            className={`client-seen${outdated ? ' outdated' : ''}`}
            title={t('Utilisé le {when}', { when: when(c.seenAt) })}
          >
            {clientLabel(c.client)}
            {outdated && <small>{t('à mettre à jour')}</small>}
          </span>
        )
      })}
    </span>
  )
}
