import { create } from 'zustand'
import type { PageAccess, PageId, PagePatch, PageSummary, Person } from '../../shared/types'
import type { Presence } from './platform'

interface State {
  pages: PageSummary[]
  /** People of the workspace (one on the desktop app) */
  people: Person[]
  currentId: PageId | null
  expanded: Record<PageId, boolean>
  searchOpen: boolean
  trashOpen: boolean
  transferOpen: boolean
  notice: string | null
  /** Increased when another person changed pages or databases (server workspace) */
  revision: number
  /** Sidebar hidden with Cmd+\\ */
  sidebarHidden: boolean
  toggleSidebar: () => void
  /** Forced theme, or the system's */
  theme: 'system' | 'light' | 'dark'
  toggleTheme: () => void
  /** Page chooser (link-to-page block…) */
  pagePicker: { title: string; onPick: (id: PageId) => void; kind?: 'database' } | null
  pickPage: (title: string, onPick: (id: PageId) => void, kind?: 'database') => void
  closePagePicker: () => void
  /** Other people connected to the server workspace, with their open page */
  presence: Presence[]
  /** Real-time connection to the server (always true in the desktop app) */
  connected: boolean
  /** Feedback window (server workspace): null when closed, else the report to show first */
  feedback: { focus: string | null } | null
  openFeedback: (focus?: string | null) => void
  closeFeedback: () => void
  /** Unread notifications */
  inboxUnread: number
  refreshInbox: () => Promise<void>
  inboxOpen: boolean
  setInboxOpen: (open: boolean) => void
  /** Comments panel of the open page */
  comments: {
    open: boolean
    /** Discussion to show first */
    focus: string | null
    /** New discussion on a selection, not posted yet */
    draft: { threadId: string; quote: string; marked: boolean } | null
  }
  openComments: (threadId?: string | null) => void
  closeComments: () => void
  startComment: (draft: { threadId: string; quote: string; marked: boolean }) => void
  clearDraft: () => void
  /** Increased when the open page's content was replaced (restored version): editors reload */
  contentReload: number
  reloadContent: () => void
  /** Reloads what another person may have changed */
  remoteChange: () => Promise<void>
  /** Equation being edited, and how to write the result back (null removes it) */
  mathEdit: { latex: string; inline: boolean; apply: (latex: string | null) => void } | null
  setMathEdit: (edit: State['mathEdit']) => void
  load: () => Promise<void>
  open: (id: PageId | null) => void
  toggle: (id: PageId) => void
  createPage: (parentId: PageId | null, access?: PageAccess) => Promise<void>
  createDatabase: (parentId: PageId | null) => Promise<PageId>
  createRow: (databaseId: PageId) => Promise<void>
  /** Creates a database under `parentId` without leaving the page, then calls `link` with its id */
  createDatabaseAndLink: (parentId: PageId | null, link: (id: PageId) => void) => Promise<void>
  patch: (id: PageId, patch: PagePatch) => Promise<void>
  move: (id: PageId, parentId: PageId | null, index: number) => Promise<void>
  trash: (id: PageId) => Promise<void>
  restore: (id: PageId) => Promise<void>
  deleteForever: (id: PageId) => Promise<void>
  duplicate: (id: PageId) => Promise<void>
  setSearchOpen: (open: boolean) => void
  setTrashOpen: (open: boolean) => void
  setTransferOpen: (open: boolean) => void
  exportPage: (id: PageId | null) => Promise<void>
  showNotice: (message: string) => void
}

const api = window.api.pages

type Theme = 'system' | 'light' | 'dark'
function storedTheme(): Theme {
  let t: string | null = null
  try {
    t = localStorage.getItem('theme')
  } catch {
    t = null
  }
  const theme: Theme = t === 'light' || t === 'dark' ? t : 'system'
  if (theme !== 'system') document.documentElement.dataset.theme = theme
  return theme
}
function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('theme', theme)
  } catch {
    // a convenience only
  }
}

/** Address of a page inside the app: #/page/<id>. */
export const pageHash = (id: PageId): string => `#/page/${id}`

export function pageIdFromHash(hash: string): PageId | null {
  const match = /^#\/page\/([A-Za-z0-9_-]{1,64})$/.exec(hash)
  return match ? match[1] : null
}

/** Full link to a page: the web address on a server, an internal link in the desktop app. */
export const pageUrl = (id: PageId): string =>
  location.protocol.startsWith('http')
    ? `${location.origin}${location.pathname}${pageHash(id)}`
    : `notionix://page/${id}`

// Back, forward, or an address typed or pasted: the page follows the address.
window.addEventListener('hashchange', () => {
  const id = pageIdFromHash(location.hash)
  const state = useStore.getState()
  if (id !== state.currentId) state.open(id)
})

/** Pages opened lately on this device, newest first. */
const RECENT_KEY = 'recentPages'
const MAX_RECENT = 12
export function recentPageIds(): PageId[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function rememberRecent(id: PageId): void {
  const next = [id, ...recentPageIds().filter((x) => x !== id)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // a convenience only
  }
}

let noticeTimer: number | undefined
function notify(set: (partial: Partial<State>) => void, message: string): void {
  window.clearTimeout(noticeTimer)
  set({ notice: message })
  noticeTimer = window.setTimeout(() => set({ notice: null }), 6000)
}

export const useStore = create<State>((set, get) => ({
  pages: [],
  people: [],
  // The address names the page (#/page/<id>): links, back and forward, new tabs.
  currentId: pageIdFromHash(location.hash) ?? localStorage.getItem('currentId'),
  expanded: JSON.parse(localStorage.getItem('expanded') ?? '{}'),
  searchOpen: false,
  trashOpen: false,
  transferOpen: false,
  notice: null,
  revision: 0,
  contentReload: 0,
  comments: { open: false, focus: null, draft: null },
  sidebarHidden: false,
  toggleSidebar: () => set({ sidebarHidden: !get().sidebarHidden }),
  theme: storedTheme(),
  toggleTheme: () => {
    // Like Notion's Cmd+Shift+L: switches to the other theme than the one shown.
    const shown =
      get().theme === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : get().theme
    const theme = shown === 'dark' ? 'light' : 'dark'
    applyTheme(theme)
    set({ theme })
  },
  pagePicker: null,
  pickPage: (title, onPick, kind) => set({ pagePicker: { title, onPick, kind } }),
  closePagePicker: () => set({ pagePicker: null }),
  presence: [],
  connected: true,
  feedback: null,
  openFeedback: (focus = null) => set({ feedback: { focus } }),
  closeFeedback: () => set({ feedback: null }),
  inboxUnread: 0,
  refreshInbox: async () => {
    try {
      const items = await window.api.inbox.list()
      set({ inboxUnread: items.filter((i) => !i.readAt).length })
    } catch {
      // the count is a hint; the next change retries
    }
  },
  inboxOpen: false,
  setInboxOpen: (inboxOpen) => set({ inboxOpen }),
  openComments: (threadId = null) =>
    set({ comments: { ...get().comments, open: true, focus: threadId } }),
  closeComments: () => set({ comments: { open: false, focus: null, draft: null } }),
  startComment: (draft) => set({ comments: { open: true, focus: draft.threadId, draft } }),
  clearDraft: () => set({ comments: { ...get().comments, draft: null } }),
  reloadContent: () => set({ contentReload: get().contentReload + 1 }),
  mathEdit: null,
  setMathEdit: (mathEdit) => set({ mathEdit }),

  load: async () => {
    const [pages, people] = await Promise.all([api.list(), window.api.people.list()])
    const { currentId } = get()
    const valid = currentId && pages.some((p) => p.id === currentId && !p.trashedAt)
    set({ pages, people, currentId: valid ? currentId : null })
  },
  remoteChange: async () => {
    await get().load()
    set({ revision: get().revision + 1 })
  },
  open: (id) => {
    if (id) {
      localStorage.setItem('currentId', id)
      rememberRecent(id)
    } else localStorage.removeItem('currentId')
    // A new history entry, so that "back" returns to the page left.
    const hash = id ? pageHash(id) : ''
    if (location.hash !== hash) {
      if (hash) location.hash = hash
      else history.pushState(null, '', location.pathname + location.search)
    }
    // A discussion being written belongs to the page being left.
    const comments = get().comments
    set({ currentId: id, comments: { ...comments, draft: null, focus: null } })
  },
  toggle: (id) => {
    const expanded = { ...get().expanded, [id]: !get().expanded[id] }
    localStorage.setItem('expanded', JSON.stringify(expanded))
    set({ expanded })
  },
  createDatabase: async (parentId) => {
    const page = await window.api.databases.create(parentId)
    await get().load()
    get().open(page.id)
    return page.id
  },
  createDatabaseAndLink: async (parentId, link) => {
    const page = await window.api.databases.create(parentId)
    if (parentId) {
      const expanded = { ...get().expanded, [parentId]: true }
      localStorage.setItem('expanded', JSON.stringify(expanded))
      set({ expanded })
    }
    await get().load()
    link(page.id)
  },
  createRow: async (databaseId) => {
    const row = await window.api.databases.createRow(databaseId, {})
    await get().load()
    get().open(row.id)
  },
  createPage: async (parentId, access) => {
    const page = await api.create(parentId, access)
    if (parentId) {
      const expanded = { ...get().expanded, [parentId]: true }
      localStorage.setItem('expanded', JSON.stringify(expanded))
      set({ expanded })
    }
    await get().load()
    get().open(page.id)
  },
  patch: async (id, patch) => {
    const updated = await api.update(id, patch)
    set({ pages: get().pages.map((p) => (p.id === id ? updated : p)) })
  },
  move: async (id, parentId, index) => {
    await api.move(id, parentId, index)
    await get().load()
  },
  trash: async (id) => {
    await api.trash(id)
    await get().load()
  },
  restore: async (id) => {
    await api.restore(id)
    await get().load()
  },
  deleteForever: async (id) => {
    await api.deleteForever(id)
    await get().load()
  },
  duplicate: async (id) => {
    const copy = await api.duplicate(id)
    await get().load()
    get().open(copy.id)
  },
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setTrashOpen: (trashOpen) => set({ trashOpen }),
  setTransferOpen: (transferOpen) => set({ transferOpen }),
  showNotice: (message) => notify(set, message),
  exportPage: async (id) => {
    try {
      const result = await window.api.transfer.exportMarkdown(id)
      if (result) notify(set, `${result.pages} page(s) exportée(s) : ${result.path}`)
    } catch (e) {
      notify(set, `Export impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}))

/** Child pages shown in the tree; rows of a database are reached through its views instead. */
export const childrenOf = (pages: PageSummary[], parentId: PageId | null): PageSummary[] =>
  parentId !== null && pages.some((p) => p.id === parentId && p.kind === 'database')
    ? []
    : parentId === null
      ? rootsOf(pages)
      : directChildren(pages, parentId)

/**
 * Top of the tree: top-level pages, plus pages whose parent this person
 * cannot see (shared with them on their own), unless they are database rows.
 */
const rootsOf = (pages: PageSummary[]): PageSummary[] => {
  const ids = new Set(pages.map((p) => p.id))
  return pages
    .filter(
      (p) =>
        !p.trashedAt &&
        p.kind !== 'synced' &&
        (p.parentId === null || !ids.has(p.parentId)) &&
        !(p.parentId !== null && p.isTemplate)
    )
    .sort((a, b) => a.position - b.position)
}

const directChildren = (pages: PageSummary[], parentId: PageId | null): PageSummary[] =>
  pages
    .filter((p) => p.parentId === parentId && !p.trashedAt && p.kind !== 'synced')
    .sort((a, b) => a.position - b.position)

export const ancestorsOf = (pages: PageSummary[], id: PageId): PageSummary[] => {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const out: PageSummary[] = []
  for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId) {
    const page = byId.get(p)
    if (!page) break
    out.unshift(page)
  }
  return out
}
