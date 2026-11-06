import { describe, expect, it } from 'vitest'
import {
  alwaysKept,
  availabilityOf,
  childrenByParent,
  emptySettings,
  parseKept,
  parseSettings,
  planWorkspace,
  versionOf,
  wantedPages
} from '../src/desktop/offlinePlan'
import { assetNamesIn } from '../src/shared/assets'
import type { PageSummary } from '../src/shared/types'

const page = (id: string, parentId: string | null, extra: Partial<PageSummary> = {}): PageSummary =>
  ({
    id,
    parentId,
    title: id,
    icon: null,
    cover: null,
    position: 0,
    favorite: false,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 10,
    version: 1,
    kind: 'page',
    isTemplate: false,
    createdBy: 'bob',
    updatedBy: 'bob',
    access: 'inherit',
    isSpace: false,
    options: {},
    publicToken: null,
    level: 'edit',
    ...extra
  }) as PageSummary

// A workspace: a wiki with two sub-pages, a database with a row, Alice's private page.
const pages = [
  page('wiki', null),
  page('guide', 'wiki'),
  page('deep', 'guide'),
  page('db', null, { kind: 'database', updatedAt: 5 }),
  page('row', 'db', { updatedAt: 30 }),
  page('mine', null, { access: 'restricted', createdBy: 'alice' }),
  page('under-mine', 'mine'),
  page('old', null, { trashedAt: 99 })
]
const byId = new Map(pages.map((p) => [p.id, p]))

describe('offline copies: what is kept', () => {
  it('follows the page, then its parents, then its workspace (kept by default)', () => {
    const settings = emptySettings()
    expect(availabilityOf('deep', byId, 'main', settings)).toEqual({
      value: 'keep',
      source: 'workspace'
    })
    settings.workspaces.main = 'online'
    expect(availabilityOf('deep', byId, 'main', settings).value).toBe('online')
    settings.pages.wiki = 'keep'
    expect(availabilityOf('deep', byId, 'main', settings)).toEqual({
      value: 'keep',
      source: 'parent'
    })
    settings.pages.deep = 'online'
    expect(availabilityOf('deep', byId, 'main', settings)).toEqual({
      value: 'online',
      source: 'page'
    })
    // Another workspace keeps its own choice.
    expect(availabilityOf('deep', byId, 'other', emptySettings()).value).toBe('keep')
  })

  it('always keeps private pages and what is under them, favorites and recent pages', () => {
    const marked = pages.map((p) => (p.id === 'guide' ? { ...p, favorite: true } : p))
    const always = alwaysKept(marked, 'alice', ['deep', 'unknown', 'old'])
    expect([...always].sort()).toEqual(['deep', 'guide', 'mine', 'under-mine'])
    // Someone else's private page is not theirs to keep.
    expect(alwaysKept(pages, 'bob', []).has('mine')).toBe(false)
  })

  it('wants every live page unless online only, except those always kept', () => {
    const settings = { workspaces: { main: 'online' as const }, pages: { wiki: 'keep' as const } }
    const always = alwaysKept(pages, 'alice', [])
    expect([...wantedPages(pages, 'main', settings, always)].sort()).toEqual([
      'deep',
      'guide',
      'mine',
      'under-mine',
      'wiki'
    ])
    expect(wantedPages(pages, 'main', emptySettings(), new Set()).has('old')).toBe(false)
  })

  it('keeps again what changed, a database when one of its rows did, and drops what is no longer wanted', () => {
    const children = childrenByParent(pages)
    expect(versionOf(byId.get('db')!, children)).toBe(30)
    expect(versionOf(byId.get('wiki')!, children)).toBe(10)
    const wanted = new Set(['wiki', 'guide', 'db', 'row', 'mine'])
    const kept = {
      wiki: { v: 10, at: 1, bytes: 5 },
      db: { v: 5, at: 1, bytes: 5 },
      deep: { v: 10, at: 1, bytes: 5 }
    }
    const { stale, evicted } = planWorkspace(pages, wanted, kept, new Set(['mine']))
    // Always kept first, then the latest changed.
    expect(stale.map((p) => p.id)).toEqual(['mine', 'row', 'guide', 'db'])
    expect(evicted).toEqual(['deep'])
  })

  it('reads back only valid choices and kept pages', () => {
    expect(
      parseSettings('{"workspaces":{"main":"online","x":"maybe"},"pages":{"a":"keep"}}')
    ).toEqual({ workspaces: { main: 'online' }, pages: { a: 'keep' } })
    expect(parseSettings('not json')).toEqual(emptySettings())
    expect(parseKept('{"main":{"a":{"v":3,"at":4},"b":{"v":"x"}}}')).toEqual({
      main: { a: { v: 3, at: 4, bytes: 0 } }
    })
  })

  it('finds the files a page or an answer refers to', () => {
    const hash = 'a'.repeat(64)
    const content = JSON.stringify({
      content: JSON.stringify({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: `notionix-asset://file/${hash}.png` } }]
      }),
      icon: `notionix-asset://file/${'b'.repeat(64)}.jpg`
    })
    expect([...assetNamesIn(content)].sort()).toEqual([`${hash}.png`, `${'b'.repeat(64)}.jpg`])
    // Not a kept type, or not a name: ignored.
    expect(assetNamesIn(`notionix-asset://file/${hash}.exe notionix-asset://file/x.png`).size).toBe(
      0
    )
  })
})
