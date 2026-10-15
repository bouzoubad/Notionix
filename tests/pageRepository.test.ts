import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'

const doc = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  })

let repo: PageRepository
let clock: number

beforeEach(() => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  clock = 1000
  repo = new PageRepository(db, () => ++clock)
})

describe('PageRepository', () => {
  it('creates pages with increasing positions and bumps version on update', () => {
    const a = repo.create(null)
    const b = repo.create(null)
    expect(b.position).toBeGreaterThan(a.position)
    const updated = repo.update(a.id, { title: 'Hello' })
    expect(updated.title).toBe('Hello')
    expect(updated.version).toBe(a.version + 1)
  })

  it('moves a page between parents at an index and rejects cycles', () => {
    const a = repo.create(null)
    const b = repo.create(null)
    const c = repo.create(a.id)
    repo.move(b.id, a.id, 0)
    const kids = repo
      .list()
      .filter((p) => p.parentId === a.id)
      .sort((x, y) => x.position - y.position)
    expect(kids.map((p) => p.id)).toEqual([b.id, c.id])
    expect(() => repo.move(a.id, c.id, 0)).toThrow(/descendants/)
    expect(() => repo.move(a.id, a.id, 0)).toThrow()
  })

  it('trashes a subtree together and restores it; re-roots when parent stays trashed', () => {
    const a = repo.create(null)
    const b = repo.create(a.id)
    const c = repo.create(b.id)
    repo.trash(a.id)
    expect(repo.list().every((p) => p.trashedAt !== null)).toBe(true)
    repo.restore(b.id)
    const after = Object.fromEntries(repo.list().map((p) => [p.id, p]))
    expect(after[b.id].trashedAt).toBeNull()
    expect(after[c.id].trashedAt).toBeNull()
    expect(after[b.id].parentId).toBeNull()
    expect(after[a.id].trashedAt).not.toBeNull()
  })

  it('deletes forever with descendants and removes them from search', () => {
    const a = repo.create(null)
    const b = repo.create(a.id)
    repo.update(b.id, { content: doc('zebra stripes') })
    expect(repo.search('zebra')).toHaveLength(1)
    repo.deleteForever(a.id)
    expect(repo.list()).toHaveLength(0)
    expect(repo.search('zebra')).toHaveLength(0)
  })

  it('searches title and body by prefix, excluding trashed pages', () => {
    const a = repo.create(null)
    repo.update(a.id, { title: 'Roadmap', content: doc('Quarterly planning notes') })
    const b = repo.create(null)
    repo.update(b.id, { title: 'Planning archive' })
    expect(
      repo
        .search('plan')
        .map((h) => h.id)
        .sort()
    ).toEqual([a.id, b.id].sort())
    repo.trash(b.id)
    expect(repo.search('plan').map((h) => h.id)).toEqual([a.id])
    expect(repo.search('  ')).toEqual([])
    expect(() => repo.search('"quote')).not.toThrow()
  })

  it('duplicates a page with its children', () => {
    const a = repo.create(null)
    repo.update(a.id, { title: 'Doc', content: doc('body') })
    repo.create(a.id)
    const copy = repo.duplicate(a.id)
    expect(copy.id).not.toBe(a.id)
    expect(copy.content).toBe(doc('body'))
    expect(repo.list().filter((p) => p.parentId === copy.id)).toHaveLength(1)
  })
})

describe('page history', () => {
  it('keeps the original content, groups close changes and restores a version', () => {
    let t = 1_000_000
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const repo = new PageRepository(db, () => t)
    repo.actor = 'alice'
    const page = repo.create(null)
    const doc = (text: string): string =>
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
      })
    repo.update(page.id, { content: doc('un') })
    t += 60_000
    repo.as('bob', () => repo.update(page.id, { content: doc('deux') }))
    let versions = repo.versions(page.id)
    expect(versions).toHaveLength(1)
    expect(versions[0].authors).toEqual(['alice', 'bob'])
    t += 11 * 60_000
    repo.update(page.id, { content: doc('trois') })
    versions = repo.versions(page.id)
    expect(
      versions.map((v) => JSON.parse(repo.version(v.id)!.content).content[0].content[0].text)
    ).toEqual(['trois', 'deux'])
    repo.restoreVersion(page.id, versions[1].id)
    expect(repo.get(page.id)!.content).toBe(doc('deux'))
    expect(repo.versions(page.id)).toHaveLength(3)
    expect(() => repo.restoreVersion(page.id, 9999)).toThrow()
  })
})
