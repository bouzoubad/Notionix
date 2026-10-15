import { describe, expect, it } from 'vitest'
import { resolveLevels, type AccessNode, type ShareRow, type Viewer } from '../src/core/access'

const node = (
  id: string,
  parentId: string | null,
  access: AccessNode['access'] = 'inherit',
  createdBy: string | null = 'alice'
): AccessNode => ({ id, parentId, access, createdBy })

const tree: AccessNode[] = [
  node('wiki', null),
  node('wiki-page', 'wiki'),
  node('private', null, 'restricted', 'alice'),
  node('private-child', 'private'),
  node('shared-child', 'private'),
  node('open-inside-private', 'private', 'workspace'),
  node('space', null, 'restricted', 'alice'),
  node('space-page', 'space'),
  node('orphan', 'missing')
]
const shares: ShareRow[] = [
  { pageId: 'shared-child', userId: 'bob', level: 'edit' },
  { pageId: 'space', userId: 'bob', level: 'full' },
  { pageId: 'shared-child', userId: 'guest', level: 'edit' },
  { pageId: 'wiki-page', userId: 'reader', level: 'full' }
]
const levels = (viewer: Viewer): Record<string, string> =>
  Object.fromEntries(resolveLevels(tree, shares, viewer))

describe('page access', () => {
  it('opens workspace pages to members, and private pages to their creator only', () => {
    const alice = levels({ id: 'alice', role: 'editor' })
    expect(alice).toMatchObject({
      wiki: 'full',
      'wiki-page': 'full',
      private: 'full',
      'private-child': 'full'
    })
    const carol = levels({ id: 'carol', role: 'admin' })
    expect(carol).toMatchObject({
      wiki: 'full',
      private: 'none',
      'private-child': 'none',
      space: 'none'
    })
    // A sub-page can open itself to the workspace.
    expect(carol['open-inside-private']).toBe('full')
  })

  it('adds what is shared, to the page and its sub-pages', () => {
    const bob = levels({ id: 'bob', role: 'editor' })
    expect(bob).toMatchObject({
      private: 'none',
      'shared-child': 'edit',
      space: 'full',
      'space-page': 'full'
    })
  })

  it('keeps guests to shared pages and readers to reading and commenting', () => {
    const guest = levels({ id: 'guest', role: 'guest' })
    expect(guest).toMatchObject({
      wiki: 'none',
      'shared-child': 'edit',
      'open-inside-private': 'none'
    })
    const reader = levels({ id: 'reader', role: 'reader' })
    expect(reader).toMatchObject({ wiki: 'comment', 'wiki-page': 'comment', private: 'none' })
  })

  it('grants nothing more for a broken tree', () => {
    expect(levels({ id: 'alice', role: 'editor' }).orphan).toBe('full')
    const looped = resolveLevels([node('a', 'b', 'inherit'), node('b', 'a', 'inherit')], [], {
      id: 'x',
      role: 'editor'
    })
    expect([...looped.values()].every((l) => l === 'none' || l === 'full')).toBe(true)
  })

  it('gives members of a group what is shared with the group, keeping the highest level', () => {
    const groupShares: ShareRow[] = [
      { pageId: 'private', userId: 'grp_team', level: 'read' },
      { pageId: 'private-child', userId: 'carol', level: 'edit' }
    ]
    const carol = resolveLevels(tree, groupShares, {
      id: 'carol',
      role: 'editor',
      groups: ['grp_team']
    })
    expect(carol.get('private')).toBe('read')
    expect(carol.get('shared-child')).toBe('read')
    expect(carol.get('private-child')).toBe('edit')
    expect(resolveLevels(tree, groupShares, { id: 'dan', role: 'editor' }).get('private')).toBe(
      'none'
    )
  })
})
