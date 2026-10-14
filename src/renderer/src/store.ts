import { create } from 'zustand'
import type { PageId, PagePatch, PageSummary } from '../../shared/types'

interface State {
  pages: PageSummary[]
  currentId: PageId | null
  expanded: Record<PageId, boolean>
  searchOpen: boolean
  trashOpen: boolean
  load: () => Promise<void>
  open: (id: PageId | null) => void
  toggle: (id: PageId) => void
  createPage: (parentId: PageId | null) => Promise<void>
  patch: (id: PageId, patch: PagePatch) => Promise<void>
  move: (id: PageId, parentId: PageId | null, index: number) => Promise<void>
  trash: (id: PageId) => Promise<void>
  restore: (id: PageId) => Promise<void>
  deleteForever: (id: PageId) => Promise<void>
  duplicate: (id: PageId) => Promise<void>
  setSearchOpen: (open: boolean) => void
  setTrashOpen: (open: boolean) => void
}

const api = window.api.pages

export const useStore = create<State>((set, get) => ({
  pages: [],
  currentId: localStorage.getItem('currentId'),
  expanded: JSON.parse(localStorage.getItem('expanded') ?? '{}'),
  searchOpen: false,
  trashOpen: false,

  load: async () => {
    const pages = await api.list()
    const { currentId } = get()
    const valid = currentId && pages.some((p) => p.id === currentId && !p.trashedAt)
    set({ pages, currentId: valid ? currentId : null })
  },
  open: (id) => {
    if (id) localStorage.setItem('currentId', id)
    else localStorage.removeItem('currentId')
    set({ currentId: id })
  },
  toggle: (id) => {
    const expanded = { ...get().expanded, [id]: !get().expanded[id] }
    localStorage.setItem('expanded', JSON.stringify(expanded))
    set({ expanded })
  },
  createPage: async (parentId) => {
    const page = await api.create(parentId)
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
  setTrashOpen: (trashOpen) => set({ trashOpen })
}))

export const childrenOf = (pages: PageSummary[], parentId: PageId | null): PageSummary[] =>
  pages
    .filter((p) => p.parentId === parentId && !p.trashedAt)
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
