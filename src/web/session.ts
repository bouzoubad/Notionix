import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import {
  PAGE_FIELD,
  WORKSPACE_DOCUMENT,
  pageDocumentName,
  type ChangeNotice,
  type SessionUser
} from '../shared/collab'
import type { Presence, ServerSession } from '../renderer/src/platform'
import { request } from './http'
import { inboxChanged } from './api'

const COLORS = ['#e03e3e', '#d9730d', '#0f7b6c', '#0b6e99', '#6940a5', '#ad1a72', '#64473a']

/** A stable color per account, so each person keeps theirs. */
function colorOf(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

/**
 * The real-time connection: one WebSocket for every shared document. The
 * session cookie authenticates it; the token sent here is a placeholder the
 * server ignores when the cookie is valid.
 */
export function connect(
  user: SessionUser,
  onChange: () => void,
  Settings: ServerSession['Settings']
): ServerSession {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`
  const socket = new HocuspocusProviderWebsocket({ url })
  const token = 'cookie'

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
      if (notice?.type !== 'changed') return
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
  const statusListeners = new Set<(connected: boolean) => void>()
  socket.on('status', ({ status }: { status: string }) => {
    statusListeners.forEach((l) => l(status === 'connected'))
  })

  return {
    user,
    Settings,
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
      const provider = new HocuspocusProvider({
        websocketProvider: socket,
        name: pageDocumentName(pageId),
        token
      })
      provider.attach()
      const ready = new Promise<void>((resolve) => {
        if (provider.isSynced) resolve()
        else provider.on('synced', () => resolve())
      })
      return {
        ready,
        extensions: [
          Collaboration.configure({ document: provider.document, field: PAGE_FIELD }),
          CollaborationCaret.configure({
            provider,
            user: { name: user.name || user.email, color }
          })
        ],
        destroy: () => provider.destroy()
      }
    },
    logout: async () => {
      try {
        await request('/api/logout', { method: 'POST' })
      } finally {
        workspace.destroy()
        socket.destroy()
        location.reload()
      }
    }
  }
}
