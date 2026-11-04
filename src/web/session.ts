import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import type * as Y from 'yjs'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import {
  PAGE_FIELD,
  WORKSPACE_DOCUMENT,
  pageDocumentName,
  type ChangeNotice,
  type SessionUser,
  type WorkspaceInfo
} from '../shared/collab'
import type { Presence, ServerSession } from '../renderer/src/platform'
import { json, request, rpcIn } from './http'
import type { PageSummary } from '../shared/types'
import { inboxChanged } from './api'
import { currentWorkspace, switchWorkspace } from './workspace'

const COLORS = ['#e03e3e', '#d9730d', '#0f7b6c', '#0b6e99', '#6940a5', '#ad1a72', '#64473a']

/** A stable color per account, so each person keeps theirs. */
function colorOf(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

/** A page document kept on this device, so that it opens without network. */
export interface KeptDocument {
  /** Resolves once what was kept is loaded into the document */
  loaded: Promise<void>
  destroy: () => void
}

/** A shared page that cannot open: no network, and never kept on this device. */
export class OfflinePageError extends Error {}

export interface ConnectOptions {
  /** The server's address (http… or https…); the page's own server by default */
  server?: string
  /** Authenticates the real-time connection; the web client's cookie does it by default */
  token?: string | (() => Promise<string>)
  /** Signs out; the web client asks its server */
  logout?: () => Promise<void>
  /** Keeps page documents on this device (desktop app) */
  keep?: (name: string, document: Y.Doc) => KeptDocument
}

/**
 * The real-time connection: one WebSocket for every shared document. The web
 * client's session cookie authenticates it (the token sent is then a
 * placeholder the server ignores); the desktop app sends its session token.
 */
export function connect(
  user: SessionUser,
  onChange: () => void,
  Settings: ServerSession['Settings'],
  Feedback: ServerSession['Feedback'],
  options: ConnectOptions = {}
): ServerSession {
  const origin = options.server ?? `${location.protocol}//${location.host}`
  const url = `${origin.replace(/^http/, 'ws')}/collab`
  const socket = new HocuspocusProviderWebsocket({ url })
  const token = options.token ?? 'cookie'

  // The workspace channel announces changes to pages and databases.
  let timer: number | undefined
  const workspace = new HocuspocusProvider({
    websocketProvider: socket,
    name: WORKSPACE_DOCUMENT,
    token,
    onStateless: ({ payload }) => {
      let notice: ChangeNotice | { type: 'inbox' } | null = null
      try {
        notice = JSON.parse(payload) as ChangeNotice | { type: 'inbox' }
      } catch {
        return
      }
      if (notice?.type === 'inbox') return inboxChanged()
      if (notice?.type !== 'changed' || notice.workspace !== currentWorkspace()) return
      // Several changes in a row are reloaded once.
      window.clearTimeout(timer)
      timer = window.setTimeout(onChange, 150)
    },
    // Reconnecting after an outage: what changed meanwhile is reloaded.
    onSynced: () => onChange()
  })
  workspace.attach()

  // Presence: who is connected, on which page (awareness of the workspace channel).
  const color = colorOf(user.id)
  workspace.setAwarenessField('user', { id: user.id, name: user.name || user.email, color })
  workspace.setAwarenessField('pageId', null)
  const presenceListeners = new Set<(people: Presence[]) => void>()
  const others = (): Presence[] => {
    const states = workspace.awareness?.getStates() ?? new Map()
    const out: Presence[] = []
    for (const [clientId, state] of states) {
      if (clientId === workspace.awareness?.clientID) continue
      const u = (state as { user?: { id?: string; name?: string; color?: string } }).user
      if (!u?.id) continue
      out.push({
        clientId,
        userId: u.id,
        name: u.name ?? '',
        color: u.color ?? '#999',
        pageId: ((state as { pageId?: string | null }).pageId as string | null) ?? null
      })
    }
    return out
  }
  workspace.on('awarenessChange', () => {
    const people = others()
    presenceListeners.forEach((l) => l(people))
  })
  /** The page documents open now, and how many use each */
  const documents = new Map<
    string,
    { provider: HocuspocusProvider; kept: KeptDocument | null; ready: Promise<void>; users: number }
  >()
  const statusListeners = new Set<(connected: boolean) => void>()
  let status = 'connecting'
  socket.on('status', (event: { status: string }) => {
    status = event.status
    statusListeners.forEach((l) => l(status === 'connected'))
  })

  return {
    user,
    Settings,
    Feedback,
    workspaces: {
      current: currentWorkspace(),
      list: async () => (await json<{ workspaces: WorkspaceInfo[] }>('/api/workspaces')).workspaces,
      switchTo: switchWorkspace,
      pagesOf: (id) => rpcIn<PageSummary[]>(id, 'pages.list'),
      locate: async (pageId) => {
        try {
          const { workspace } = await json<{ workspace: string }>(
            `/api/locate/${encodeURIComponent(pageId)}`
          )
          return workspace
        } catch {
          return null
        }
      }
    },
    setPage: (pageId) => workspace.setAwarenessField('pageId', pageId),
    onPresence: (listener) => {
      presenceListeners.add(listener)
      listener(others())
      return () => presenceListeners.delete(listener)
    },
    onStatus: (listener) => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    openPage: (pageId) => {
      const name = pageDocumentName(pageId)
      // One connection per document: the editor, a synced block shown twice and
      // the pages kept for offline use share it (two would be refused).
      let entry = documents.get(name)
      if (!entry) {
        const provider = new HocuspocusProvider({ websocketProvider: socket, name, token })
        const kept = options.keep?.(name, provider.document) ?? null
        provider.attach()
        const ready = new Promise<void>((resolve, reject) => {
          if (provider.isSynced) return resolve()
          provider.on('synced', () => resolve())
          if (!kept) return
          // Kept on this device: it opens at once, the server's changes merge in when they come.
          void kept.loaded.then(() => {
            if (provider.document.store.clients.size > 0) return resolve()
            const offline = (): void => {
              if (!provider.isSynced) reject(new OfflinePageError())
            }
            if (status === 'disconnected') return offline()
            const watch = (event: { status: string }): void => {
              if (event.status !== 'disconnected') return
              socket.off('status', watch)
              offline()
            }
            socket.on('status', watch)
            provider.on('synced', () => socket.off('status', watch))
          })
        })
        // Read by each user of the document: never an unhandled rejection here.
        ready.catch(() => undefined)
        entry = { provider, kept, ready, users: 0 }
        documents.set(name, entry)
      }
      const shared = entry
      shared.users++
      let closed = false
      return {
        ready: shared.ready,
        extensions: [
          Collaboration.configure({ document: shared.provider.document, field: PAGE_FIELD }),
          CollaborationCaret.configure({
            provider: shared.provider,
            user: { name: user.name || user.email, color }
          })
        ],
        destroy: () => {
          if (closed) return
          closed = true
          if (--shared.users > 0) return
          documents.delete(name)
          shared.provider.destroy()
          shared.kept?.destroy()
        }
      }
    },
    logout: async () => {
      try {
        if (options.logout) await options.logout()
        else await request('/api/logout', { method: 'POST' })
      } finally {
        workspace.destroy()
        socket.destroy()
        location.reload()
      }
    }
  }
}
