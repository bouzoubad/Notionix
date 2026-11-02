import type { SessionUser } from '../shared/collab'
import { OFFLINE_HEADER, type ServerLinkStatus } from '../shared/desktop'
import type { PageId, PageSummary } from '../shared/types'
import { setPlatform } from '../renderer/src/platform'
import { webApi } from '../web/api'
import { json, request, rpc, ServerError, setTransport, whenSignedOut } from '../web/http'
import { connect } from '../web/session'
import { SettingsDialog } from '../web/SettingsDialog'
import { FeedbackDialog } from '../web/FeedbackDialog'
import { combineApis, type CombinedApi } from './combinedApi'
import { ConnectDialog } from './ConnectDialog'
import { forgetKeptDocuments, keepDocuments } from './offline'
import { OfflineQueue } from './offlineQueue'
import { sendLocalPages, type ServerTarget } from './sendToServer'
import { desktopTransport } from './transport'

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
  const { useStore } = await import('../renderer/src/store')
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
        await forgetKeptDocuments()
        await bridge.server.logout()
      },
      keep: keepDocuments(status.url, user.id)
    }
  )
  setPlatform({
    kind: 'desktop',
    session,
    origin: status.url,
    isLocal: api.isLocal,
    ServerConnect: ConnectDialog
  })
  // The session ended meanwhile: the app starts again and asks for the password.
  whenSignedOut(() => location.reload())
  watchNetwork(api, user, session.onStatus)
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
  onStatus: (listener: (connected: boolean) => void) => () => void
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
        if (!api.queue.pending && useStore.getState().connected) await keepPrivatePages(api, user)
      } catch (e) {
        if (!isOffline(e)) console.warn(e)
      } finally {
        running = null
      }
    })())
  onStatus((connected) => {
    if (connected) void catchUp()
  })
  setTimeout(() => void catchUp(), 3000)
  setInterval(() => void catchUp(), 60_000)
  // A page written here is sent once the editor leaves it.
  void import('../renderer/src/store').then(({ useStore }) => {
    let current = useStore.getState().currentId
    useStore.subscribe((s) => {
      if (s.currentId === current) return
      const left = current
      current = s.currentId
      if (left && api.isLocal(left)) void catchUp()
    })
  })
}

const KEPT_KEY = 'notionix-kept-at'

/**
 * Keeps on this computer, for working without network, every private page
 * of the person (and what is under it), the favorites and the recent pages:
 * their shared document and what the server says of them. Only what changed
 * since the last time is fetched again.
 */
async function keepPrivatePages(api: CombinedApi, user: SessionUser): Promise<void> {
  const { useStore, recentPageIds } = await import('../renderer/src/store')
  const { pages } = useStore.getState()
  const live = pages.filter((p) => !p.trashedAt && !api.isLocal(p.id))
  const wanted = new Set<PageId>()
  const under = (id: PageId): void => {
    wanted.add(id)
    for (const p of live) if (p.parentId === id) under(p.id)
  }
  for (const p of live)
    if (p.parentId === null && p.access === 'restricted' && p.createdBy === user.id) under(p.id)
  for (const p of live) if (p.favorite) wanted.add(p.id)
  for (const id of recentPageIds()) wanted.add(id)
  let kept: Record<PageId, number> = {}
  try {
    kept = JSON.parse(storage()?.getItem(KEPT_KEY) ?? '{}') as Record<PageId, number>
  } catch {
    kept = {}
  }
  const byId = new Map(live.map((p) => [p.id, p]))
  const stale = [...wanted].filter((id) => {
    const page = byId.get(id)
    return page && (kept[id] ?? 0) < page.updatedAt
  })
  for (const id of stale) {
    if (!useStore.getState().connected) break
    const page = byId.get(id)!
    await api.pages.get(id).catch(() => null)
    if (page.kind === 'database') await api.databases.get(id).catch(() => null)
    await keepForOffline([id])
    kept[id] = Date.now()
    try {
      storage()?.setItem(KEPT_KEY, JSON.stringify(kept))
    } catch {
      // Fetched again next time.
    }
  }
}

/** Keeps the shared documents of these server pages on this computer, to open them without network. */
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
