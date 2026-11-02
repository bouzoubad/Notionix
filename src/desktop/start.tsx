import type { SessionUser } from '../shared/collab'
import type { ServerLinkStatus } from '../shared/desktop'
import { setPlatform } from '../renderer/src/platform'
import { webApi } from '../web/api'
import { json, ServerError, setTransport, whenSignedOut } from '../web/http'
import { connect } from '../web/session'
import { SettingsDialog } from '../web/SettingsDialog'
import { FeedbackDialog } from '../web/FeedbackDialog'
import { combineApis } from './combinedApi'
import { ConnectDialog } from './ConnectDialog'
import { forgetKeptDocuments, keepDocuments } from './offline'
import { desktopTransport } from './transport'

/**
 * Starts the desktop app linked to a server: private pages from this
 * computer, the team's from the server (or from what was kept of them when
 * it is out of reach). Returns false when the session has ended: the app
 * then starts on this computer's pages and asks for the password.
 */
export async function startLinked(status: ServerLinkStatus): Promise<boolean> {
  const bridge = window.desktop!
  setTransport(desktopTransport(bridge.server))
  let user: SessionUser = status.user
  try {
    user = (await json<{ user: SessionUser }>('/api/me')).user
  } catch (e) {
    if (e instanceof ServerError && e.status === 401) return false
    // Out of reach: the account kept from the last connection.
  }
  const { useStore } = await import('../renderer/src/store')
  const api = combineApis(bridge.api, webApi, {
    currentPage: () => useStore.getState().currentId,
    user
  })
  window.api = api
  setPlatform({
    kind: 'desktop',
    session: connect(
      user,
      () => void useStore.getState().remoteChange(),
      ({ onClose }) => <SettingsDialog user={user} onClose={onClose} />,
      ({ onClose, focus }) => <FeedbackDialog user={user} focus={focus} onClose={onClose} />,
      {
        server: status.url,
        token: async () => (await bridge.server.token()) ?? '',
        logout: async () => {
          await forgetKeptDocuments()
          await bridge.server.logout()
        },
        keep: keepDocuments(status.url, user.id)
      }
    ),
    origin: status.url,
    isLocal: api.isLocal,
    ServerConnect: ConnectDialog
  })
  // The session ended meanwhile: the app starts again and asks for the password.
  whenSignedOut(() => location.reload())
  return true
}

/** Keeps the favorite and recent team pages on this computer, to read them without network. */
export async function keepForOffline(pageIds: string[]): Promise<void> {
  const { platform, sessionFor } = await import('../renderer/src/platform')
  for (const id of pageIds) {
    const session = sessionFor(id)
    if (!session || platform().session !== session) continue
    const page = session.openPage(id)
    await Promise.race([
      page.ready.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 15_000))
    ])
    // Leaves time to store what arrived.
    await new Promise((resolve) => setTimeout(resolve, 500))
    page.destroy()
  }
}
