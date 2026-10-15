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
import type { ServerSession } from '../renderer/src/platform'
import { request } from './http'

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
export function connect(user: SessionUser, onChange: () => void): ServerSession {
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
      let notice: ChangeNotice | null = null
      try {
        notice = JSON.parse(payload) as ChangeNotice
      } catch {
        return
      }
      if (notice?.type !== 'changed') return
      // Several changes in a row are reloaded once.
      window.clearTimeout(timer)
      timer = window.setTimeout(onChange, 150)
    },
    // Reconnecting after an outage: what changed meanwhile is reloaded.
    onSynced: () => onChange()
  })
  workspace.attach()

  return {
    user,
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
            user: { name: user.name || user.email, color: colorOf(user.id) }
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
