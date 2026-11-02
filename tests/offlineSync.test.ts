import { beforeEach, describe, expect, it } from 'vitest'
import { OfflineQueue, type QueuedChange } from '../src/desktop/offlineQueue'
import {
  assetsOf,
  pendingParents,
  sendLocalPages,
  type ServerTarget
} from '../src/desktop/sendToServer'
import type { DesktopLocalStore } from '../src/shared/desktop'
import type { PageAccess, PageSummary, PageTreeNode } from '../src/shared/types'

/** Storage of the page (localStorage) in a Map. */
class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v)
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
}
beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

const summary = (id: string, parentId: string | null, position: number): PageSummary =>
  ({
    id,
    parentId,
    title: id,
    icon: null,
    cover: null,
    position,
    favorite: false,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
    version: 1,
    kind: 'page',
    isTemplate: false,
    createdBy: 'u1',
    updatedBy: 'u1',
    access: 'inherit',
    isSpace: false,
    options: {},
    publicToken: null,
    level: 'full'
  }) as PageSummary

const OFFLINE = new Error('hors ligne')

describe('changes made without network', () => {
  it('shows them over what the server last said', () => {
    const queue = new OfflineQueue('q', new MemoryStorage())
    const list = [summary('a', null, 1), summary('b', null, 2), summary('a1', 'a', 1)]
    queue.push({ kind: 'update', id: 'a', patch: { title: 'Renommée', content: 'x' }, at: 5 })
    queue.push({ kind: 'move', id: 'b', parentId: 'a', index: 0, at: 6 })
    queue.push({ kind: 'trash', id: 'a1', at: 7 })
    const shown = new Map(queue.overlayList(list).map((p) => [p.id, p]))
    expect(shown.get('a')).toMatchObject({ title: 'Renommée', updatedAt: 5 })
    expect(shown.get('a')).not.toHaveProperty('content')
    expect(shown.get('b')).toMatchObject({ parentId: 'a', position: 0 })
    expect(shown.get('a1')?.trashedAt).toBe(7)
    // Unchanged: what the server said.
    expect(list[0].title).toBe('a')
  })

  it('sends them in order once the network is back, drops what the server refuses', async () => {
    const storage = new MemoryStorage()
    const queue = new OfflineQueue('q', storage)
    queue.push({ kind: 'update', id: 'a', patch: { title: '1' }, at: 1 })
    queue.push({ kind: 'trash', id: 'gone', at: 2 })
    queue.push({ kind: 'update', id: 'a', patch: { title: '2' }, at: 3 })
    // Kept across a restart.
    expect(new OfflineQueue('q', storage).list()).toHaveLength(3)

    let network = false
    const sent: QueuedChange[] = []
    const send = async (c: QueuedChange): Promise<void> => {
      if (!network) throw OFFLINE
      if (c.id === 'gone') throw new Error('Page introuvable.')
      sent.push(c)
    }
    const offline = (e: unknown): boolean => e === OFFLINE
    expect(await queue.flush(send, offline)).toEqual({ sent: 0, dropped: [] })
    expect(queue.pending).toBe(true)
    network = true
    const report = await queue.flush(send, offline)
    expect(report.sent).toBe(2)
    expect(report.dropped).toHaveLength(1)
    expect(sent.map((c) => (c.kind === 'update' ? c.patch.title : c.kind))).toEqual(['1', '2'])
    expect(queue.pending).toBe(false)
    expect(storage.getItem('q')).toBeNull()
  })
})

const node = (id: string, parentId: string | null, content = '{"type":"doc"}'): PageTreeNode => ({
  id,
  parentId,
  title: id,
  icon: null,
  cover: null,
  content,
  kind: 'page',
  dbSchema: null,
  properties: null,
  isTemplate: false,
  options: null
})

const IMAGE = `${'a'.repeat(64)}.png`

/** This computer's pages, and a server that receives them. */
function setup(trees: Record<string, PageTreeNode[]>): {
  store: DesktopLocalStore & { forgotten: string[] }
  local: {
    pages: { list: () => Promise<PageSummary[]>; duplicate: (id: string) => Promise<PageSummary> }
  }
  server: ServerTarget & {
    pages: Map<string, { parentId: string | null; access?: PageAccess }>
    assets: string[]
    calls: number
    down: boolean
    refuse: Set<string>
  }
} {
  const forgotten: string[] = []
  const store = {
    forgotten,
    tree: async (id: string) => (forgotten.includes(id) ? [] : (trees[id] ?? [])),
    asset: async (name: string) => (name === IMAGE ? new Uint8Array([1]) : null),
    forget: async (id: string) => {
      forgotten.push(id)
    }
  }
  const local = {
    pages: {
      list: async () =>
        Object.keys(trees)
          .filter((id) => !forgotten.includes(id))
          .map((id) => summary(id, null, 1)),
      duplicate: async (id: string) => {
        const copy = `${id}-copie`
        trees[copy] = (trees[id] ?? []).map((n) => ({ ...n, id: n.id === id ? copy : n.id }))
        return summary(copy, null, 1)
      }
    }
  }
  const pages = new Map<string, { parentId: string | null; access?: PageAccess }>([
    ['equipe', { parentId: null }]
  ])
  const server = {
    pages,
    assets: [] as string[],
    calls: 0,
    down: false,
    refuse: new Set<string>(),
    putAsset: async (name: string) => {
      if (server.down) throw OFFLINE
      server.assets.push(name)
    },
    adopt: async (parentId: string | null, nodes: PageTreeNode[], access?: PageAccess) => {
      if (server.down) throw OFFLINE
      server.calls++
      if (parentId && (!pages.has(parentId) || server.refuse.has(parentId)))
        throw new Error('Page introuvable.')
      for (const n of nodes)
        pages.set(n.id, {
          parentId: n.parentId ?? parentId,
          access: n.parentId ? undefined : access
        })
      return null
    },
    ids: async () => {
      if (server.down) throw OFFLINE
      return new Set(pages.keys())
    },
    offline: (e: unknown) => e === OFFLINE
  }
  return { store, local, server }
}

describe('pages written without network, sent to the server', () => {
  it('sends each page with its files and sub-pages, then deletes it here', async () => {
    const withImage = JSON.stringify({ src: `notionix-asset://file/${IMAGE}` })
    const { store, local, server } = setup({
      perso: [node('perso', null, withImage), node('perso-1', 'perso')],
      ailleurs: [node('ailleurs', null)]
    })
    pendingParents.set('ailleurs', 'equipe')
    expect(assetsOf([node('x', null, withImage)])).toEqual([IMAGE])

    const report = await sendLocalPages(local, store, server)
    expect(report).toEqual({ sent: ['perso', 'ailleurs'], failed: [] })
    expect(server.assets).toEqual([IMAGE])
    expect(server.pages.get('perso')).toEqual({ parentId: null, access: 'restricted' })
    expect(server.pages.get('perso-1')).toEqual({ parentId: 'perso', access: undefined })
    // Written under a page of the server: goes back under it.
    expect(server.pages.get('ailleurs')).toEqual({ parentId: 'equipe', access: undefined })
    expect(store.forgotten).toEqual(['perso', 'ailleurs'])
    expect(pendingParents.all()).toEqual({})
  })

  it('waits for the network, and for the editor to leave a page', async () => {
    const { store, local, server } = setup({ a: [node('a', null)], b: [node('b', null)] })
    server.down = true
    expect(await sendLocalPages(local, store, server)).toEqual({ sent: [], failed: [] })
    expect(store.forgotten).toEqual([])
    server.down = false
    expect((await sendLocalPages(local, store, server, (id) => id === 'a')).sent).toEqual(['b'])
    expect((await sendLocalPages(local, store, server)).sent).toEqual(['a'])
  })

  it('keeps as a copy what was changed here while being sent', async () => {
    const trees = { a: [node('a', null)] }
    const { store, local, server } = setup(trees)
    const adopt = server.adopt
    server.adopt = async (...args) => {
      const r = await adopt(...args)
      // Typed in the page meanwhile.
      trees.a = [{ ...trees.a[0], content: '{"type":"doc","modifié":true}' }]
      return r
    }
    expect((await sendLocalPages(local, store, server)).sent).toEqual(['a'])
    expect(store.forgotten).toEqual(['a'])
    expect((await local.pages.list()).map((p) => p.id)).toEqual(['a-copie'])
  })

  it('sends as a private page what was written under a page now gone', async () => {
    const { store, local, server } = setup({ a: [node('a', null)] })
    pendingParents.set('a', 'equipe')
    server.refuse.add('equipe')
    expect((await sendLocalPages(local, store, server)).sent).toEqual(['a'])
    expect(server.pages.get('a')).toEqual({ parentId: null, access: 'restricted' })
  })

  it('sends a big tree in pieces, and finishes one cut short', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) })
    const nodes = [node('r', null), node('c1', 'r', big), node('c2', 'r', big), node('c2a', 'c2')]
    const { store, local, server } = setup({ r: nodes })
    // An earlier attempt left the root and its first sub-page on the server.
    server.pages.set('r', { parentId: null, access: 'restricted' })
    server.pages.set('c1', { parentId: 'r' })
    expect((await sendLocalPages(local, store, server)).sent).toEqual(['r'])
    expect(server.calls).toBe(1)
    expect(server.pages.get('c2a')).toEqual({ parentId: 'c2', access: undefined })
  })
})
