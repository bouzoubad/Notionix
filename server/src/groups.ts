import type { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'crypto'
import type { PersonGroup } from '../../src/shared/types'

export class GroupError extends Error {}

const MAX_NAME = 80

/** Groups of people, server-wide: sharing a page with a group shares it with each member. */
export class Groups {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now
  ) {}

  list(): PersonGroup[] {
    const members = new Map<string, string[]>()
    const rows = this.db.prepare('SELECT group_id, user_id FROM group_members').all() as {
      group_id: string
      user_id: string
    }[]
    for (const r of rows) members.set(r.group_id, [...(members.get(r.group_id) ?? []), r.user_id])
    return (
      this.db.prepare('SELECT id, name FROM groups ORDER BY name').all() as {
        id: string
        name: string
      }[]
    ).map((g) => ({ id: g.id, name: g.name, memberIds: members.get(g.id) ?? [] }))
  }

  get(id: string): PersonGroup | null {
    return this.list().find((g) => g.id === id) ?? null
  }

  create(name: string, memberIds: string[] = []): PersonGroup {
    const id = `grp_${randomBytes(9).toString('base64url')}`
    this.db
      .prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)')
      .run(id, groupName(name), this.now())
    this.setMembers(id, memberIds)
    return this.get(id)!
  }

  update(id: string, patch: { name?: string; memberIds?: string[] }): PersonGroup {
    if (!this.get(id)) throw new GroupError('Groupe introuvable.')
    if (patch.name !== undefined)
      this.db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(groupName(patch.name), id)
    if (patch.memberIds !== undefined) this.setMembers(id, patch.memberIds)
    return this.get(id)!
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(id)
  }

  /** Unknown accounts are left out. */
  private setMembers(id: string, memberIds: string[]): void {
    this.db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id)
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id)
       SELECT ?, id FROM users WHERE id = ?`
    )
    for (const userId of new Set(memberIds)) insert.run(id, userId)
  }
}

function groupName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new GroupError('Nom de groupe requis.')
  if (trimmed.length > MAX_NAME) throw new GroupError('Nom de groupe trop long.')
  return trimmed
}
