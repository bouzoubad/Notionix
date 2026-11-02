import { describe, expect, it } from 'vitest'
import { combineApis } from '../src/desktop/combinedApi'
import type { NotionixApi } from '../src/shared/types'

type Call = { section: string; method: string; args: unknown[] }

/**
 * A fake side: records every call and answers from `answers` (by
 * "section.method"), or with an object carrying a fresh id.
 */
interface Side {
  api: NotionixApi
  calls: Call[]
  last: () => Call
}

function side(name: string, answers: Record<string, (...args: unknown[]) => unknown> = {}): Side {
  const calls: Call[] = []
  let n = 0
  const api = new Proxy(
    {},
    {
      get: (_t, section: string) =>
        new Proxy(
          {},
          {
            get:
              (_s, method: string) =>
              (...args: unknown[]) => {
                calls.push({ section, method, args })
                const answer = answers[`${section}.${method}`]
                if (answer) return answer(...args)
                if (method === 'onChange') return () => undefined
                return Promise.resolve({ id: `${name}-${++n}` })
              }
          }
        )
    }
  ) as NotionixApi
  return { api, calls, last: () => calls[calls.length - 1] }
}

const user = { id: 'u1', email: 'moi@example.com', name: 'Moi', role: 'editor' as const }
const summary = (id: string): { id: string; parentId: null; title: string } => ({
  id,
  parentId: null,
  title: id
})

function setup(current: string | null = null): {
  local: Side
  remote: Side
  api: ReturnType<typeof combineApis>
  setCurrent: (id: string | null) => void
} {
  const local = side('local', {
    'pages.list': async () => [summary('mac-1'), summary('mac-2')],
    'pages.search': async () => [{ id: 'mac-1' }, { id: 'mac-2' }],
    'inbox.list': async () => [{ id: 'n-mac', createdAt: 1 }],
    'comments.list': async () => [{ id: 'c-mac', threadId: 'c-mac' }]
  })
  const remote = side('remote', {
    'pages.list': async () => [summary('team-1')],
    'pages.search': async () => [{ id: 'team-1' }],
    'inbox.list': async () => [{ id: 'n-team', createdAt: 2 }],
    'people.list': async () => [{ id: 'u1', name: 'Moi', email: 'moi@example.com' }]
  })
  let currentPage = current
  const api = combineApis(local.api, remote.api, { currentPage: () => currentPage, user })
  return {
    local,
    remote,
    api,
    setCurrent: (id) => {
      currentPage = id
    }
  }
}

describe('desktop app linked to a server', () => {
  it('lists both sides and sends each page to its own', async () => {
    const { local, remote, api } = setup()
    const pages = await api.pages.list()
    expect(pages.map((p) => p.id)).toEqual(['team-1', 'mac-1', 'mac-2'])
    expect(api.isLocal('mac-1')).toBe(true)
    expect(api.isLocal('team-1')).toBe(false)

    await api.pages.get('mac-2')
    expect(local.last()).toMatchObject({ method: 'get', args: ['mac-2'] })
    await api.pages.update('team-1', { title: 'Équipe' })
    expect(remote.last()).toMatchObject({ method: 'update', args: ['team-1', { title: 'Équipe' }] })
    await api.databases.updateRow('mac-1', {})
    expect(local.last()).toMatchObject({ section: 'databases', method: 'updateRow' })
  })

  it('creates private top-level pages here, the others on the server, sub-pages with their parent', async () => {
    const { local, remote, api } = setup()
    await api.pages.list()

    const mine = await api.pages.create(null, 'restricted')
    expect(local.last()).toMatchObject({ method: 'create', args: [null, 'restricted', undefined] })
    expect(api.isLocal(mine.id)).toBe(true)

    await api.pages.create(null)
    expect(remote.last()).toMatchObject({ method: 'create', args: [null, undefined, undefined] })

    const child = await api.pages.createWith('mac-1', { title: 'Sous-page' })
    expect(local.last()).toMatchObject({ method: 'createWith' })
    expect(api.isLocal(child.id)).toBe(true)

    await api.pages.create('team-1', undefined, 'synced')
    expect(remote.last()).toMatchObject({ method: 'create', args: ['team-1', undefined, 'synced'] })

    const row = await api.databases.createRow('mac-2', {})
    expect(api.isLocal(row.id)).toBe(true)
    await api.databases.create(null)
    expect(remote.last()).toMatchObject({ section: 'databases', method: 'create' })
  })

  it('refuses to move a page between this computer and the server', async () => {
    const { api } = setup()
    await api.pages.list()
    await expect(api.pages.move('mac-1', 'team-1', 0)).rejects.toThrow()
    await expect(api.pages.move('team-1', 'mac-1', 0)).rejects.toThrow()
    await expect(api.pages.move('mac-1', 'mac-2', 0)).resolves.toBeDefined()
  })

  it('keeps the files of a private page on this computer', async () => {
    const { local, remote, api, setCurrent } = setup()
    await api.pages.list()
    setCurrent('mac-1')
    await api.assets.save(new Uint8Array([1]), 'image.png')
    expect(local.last()).toMatchObject({ section: 'assets', method: 'save' })
    setCurrent('team-1')
    await api.assets.saveFile(new Uint8Array([1]), 'doc.pdf')
    expect(remote.last()).toMatchObject({ section: 'assets', method: 'saveFile' })
  })

  it('searches both sides, and works on its own when the server is out of reach', async () => {
    const { api } = setup()
    await api.pages.list()
    expect((await api.pages.search('x')).map((h) => h.id)).toEqual(['team-1', 'mac-1', 'mac-2'])

    const local = side('local', { 'pages.list': async () => [summary('mac-1')] })
    const remote = side('remote', {
      'pages.list': async () => {
        throw new Error('hors ligne')
      },
      'people.list': async () => {
        throw new Error('hors ligne')
      }
    })
    const offline = combineApis(local.api, remote.api, { currentPage: () => null, user })
    expect((await offline.pages.list()).map((p) => p.id)).toEqual(['mac-1'])
    // The local person keeps a name, without being offered in mentions.
    expect(await offline.people.list()).toEqual([
      { id: 'local', name: 'Moi', email: 'moi@example.com', disabled: true }
    ])
  })

  it('gathers notifications and marks each read on its side', async () => {
    const { local, remote, api } = setup()
    expect((await api.inbox.list()).map((i) => i.id)).toEqual(['n-team', 'n-mac'])
    await api.inbox.markRead(['n-mac', 'n-team'])
    expect(local.last()).toMatchObject({ method: 'markRead', args: [['n-mac']] })
    expect(remote.last()).toMatchObject({ method: 'markRead', args: [['n-team']] })
  })

  it('sends a comment change to the side of its page', async () => {
    const { local, api } = setup()
    await api.pages.list()
    await api.comments.list('mac-1')
    await api.comments.resolve('c-mac', true)
    expect(local.last()).toMatchObject({ method: 'resolve', args: ['c-mac', true] })
  })
})

describe('references between this computer and the server', () => {
  it('never offers a private page to a team page', async () => {
    const { setPlatform, canReference } = await import('../src/renderer/src/platform')
    const local = new Set(['mac-1', 'mac-2'])
    setPlatform({ kind: 'desktop', session: null, isLocal: (id) => local.has(id) })
    expect(canReference('team-1', 'mac-1')).toBe(false)
    expect(canReference('team-1', 'team-2')).toBe(true)
    expect(canReference('mac-1', 'team-1')).toBe(true)
    expect(canReference('mac-1', 'mac-2')).toBe(true)
    // Relations and database views: the same side only.
    expect(canReference('mac-1', 'team-1', true)).toBe(false)
    expect(canReference('team-1', 'team-2', true)).toBe(true)
    setPlatform({ kind: 'desktop', session: null })
    expect(canReference('team-1', 'mac-1', true)).toBe(true)
  })
})
