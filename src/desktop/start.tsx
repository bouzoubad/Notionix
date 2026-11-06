import type { SessionUser } from '../shared/collab'
// The dialogs shared with the web client (feedback, account, administration) are styled there.
import '../web/web.css'
import { OFFLINE_HEADER, type ServerLinkStatus } from '../shared/desktop'
import type { PageSummary } from '../shared/types'
import { setPlatform } from '../renderer/src/platform'
import { webApi } from '../web/api'
import { json, request, rpc, ServerError, setTransport, whenSignedOut } from '../web/http'
import { connect } from '../web/session'
import { SettingsDialog } from '../web/SettingsDialog'
import { FeedbackDialog } from '../web/FeedbackDialog'
import { combineApis, type CombinedApi } from './combinedApi'
import { ConnectDialog } from './ConnectDialog'
import { UpdateNotice } from './UpdateNotice'
import { accountAppearance } from '../web/accountAppearance'
import { teamEmojis } from '../web/teamEmojis'
import { loadAccountAppearance } from '../renderer/src/appearance'
import { forgetKeptDocuments, keepDocuments } from './offline'
import { OfflineQueue } from './offlineQueue'
import { sendLocalPages, type ServerTarget } from './sendToServer'
import { desktopTransport, serverUnreachable } from './transport'
import { OfflineSync } from './offlineSync'
import { OfflineDialog } from './OfflineDialog'

/** The server out of reach: the main process answers 503 (and what it kept, for reading). */
const isOffline = (e: unknown): boolean => e instanceof ServerError && e.status === 503

/** The account the pages written here without network belong to (sent only to it). */
const LOCAL_ACCOUNT_KEY = 'notionix-local-account'
const storage = (): Storage | null => {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** The linked server, for sending it what was written without network. */
const serverTarget: ServerTarget = {
  putAsset: async (name, bytes) => {
    await request(`/api/assets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
      type: 'application/octet-stream'
    })
  },
  adopt: (parentId, nodes, access) => rpc('pages.adopt', parentId, nodes, access),
  ids: async () => {
    const res = await request('/api/rpc', { json: { method: 'pages.list', args: [] } })
    // An answer kept from an earlier connection says nothing about now.
    if (res.headers.has(OFFLINE_HEADER)) throw new ServerError(503, 'offline')
    const { result } = (await res.json()) as { result: PageSummary[] }
    return new Set(result.map((p) => p.id))
  },
  offline: isOffline
}

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
  // Copies kept by earlier versions could add a page's content twice: dropped.
  await forgetKeptDocuments(true)
  const { useStore, recentPageIds } = await import('../renderer/src/store')
  const { platform } = await import('../renderer/src/platform')
  const queue = new OfflineQueue(`notionix-queue:${status.url}|${user.id}`, storage())
  const api = combineApis(bridge.api, webApi, {
    currentPage: () => useStore.getState().currentId,
    user,
    offline: (e) => {
      if (!isOffline(e)) return false
      // Pages written here from now on belong to this account.
      storage()?.setItem(LOCAL_ACCOUNT_KEY, user.id)
      return true
    },
    queue
  })
  window.api = api
  // The team's pages kept on this computer for working without network.
  const sync = new OfflineSync({
    server: status.url,
    user,
    bridge: bridge.server,
    storage: storage(),
    pages: () => useStore.getState().pages,
    recent: recentPageIds,
    connected: () => useStore.getState().connected,
    isLocal: api.isLocal,
    session: () => platform().session
  })
  const session = connect(
    user,
    () => void useStore.getState().remoteChange(),
    ({ onClose }) => <SettingsDialog user={user} onClose={onClose} />,
    ({ onClose, focus }) => <FeedbackDialog user={user} focus={focus} onClose={onClose} />,
    {
      server: status.url,
      token: async () => (await bridge.server.token()) ?? '',
      logout: async () => {
        queue.clear()
        sync.forget()
        await forgetKeptDocuments()
        await bridge.server.logout()
      },
      keep: keepDocuments(status.url, user.id),
      unreachable: serverUnreachable
    }
  )
  setPlatform({
    kind: 'desktop',
    session,
    origin: status.url,
    isLocal: api.isLocal,
    ServerConnect: ConnectDialog,
    Notices: UpdateNotice,
    appearance: accountAppearance,
    emojis: teamEmojis,
    offline: sync.copies(({ onClose, connected }) => (
      <OfflineDialog sync={sync} connected={connected} onClose={onClose} />
    ))
  })
  void loadAccountAppearance()
  // The session ended meanwhile: the app starts again and asks for the password.
  whenSignedOut(() => location.reload())
  watchNetwork(api, user, session.onStatus, sync)
  return true
}

/**
 * When the network is there (at start, when it comes back, and regularly):
 * sends the changes made without it, then the pages written on this
 * computer, and keeps the private pages here for the next time.
 */
function watchNetwork(
  api: CombinedApi,
  user: SessionUser,
  onStatus: (listener: (connected: boolean) => void) => () => void,
  sync: OfflineSync
): void {
  let running: Promise<void> | null = null
  const catchUp = (): Promise<void> =>
    (running ??= (async () => {
      const { useStore } = await import('../renderer/src/store')
      try {
        const queued = api.queue.pending
        await api.flushQueue()
        const owner = storage()?.getItem(LOCAL_ACCOUNT_KEY)
        const report =
          owner && owner !== user.id
            ? { sent: [], failed: [] }
            : await sendLocalPages(
                window.desktop!.api,
                window.desktop!.local,
                serverTarget,
                (id) => useStore.getState().currentId === id,
                () => void useStore.getState().remoteChange()
              )
        for (const f of report.failed) console.warn('Page not sent to the server:', f)
        if (queued || report.sent.length) await useStore.getState().remoteChange()
        // The copies for working without network, in the background (a long first pass).
        if (!api.queue.pending && useStore.getState().connected) void sync.run()
      } catch (e) {
        if (!isOffline(e)) console.warn(e)
      } finally {
        running = null
      }
    })())
  onStatus((connected) => {
    // Connected again: the main process tries the server at once instead of answering from what it kept.
    if (connected)
      void window
        .desktop!.server.probe()
        .catch(() => false)
        .then(() => catchUp())
  })
  setTimeout(() => void catchUp(), 3000)
  setInterval(() => void catchUp(), 60_000)
  // A page written here is sent once the editor leaves it; pages changed by others are kept again.
  void import('../renderer/src/store').then(({ useStore }) => {
    let current = useStore.getState().currentId
    let revision = useStore.getState().revision
    let changed: number | undefined
    useStore.subscribe((s) => {
      if (s.revision !== revision) {
        revision = s.revision
        window.clearTimeout(changed)
        changed = window.setTimeout(() => s.connected && void sync.run(), 5000)
      }
      if (s.currentId === current) return
      const left = current
      current = s.currentId
      if (left && api.isLocal(left)) void catchUp()
    })
  })
}
