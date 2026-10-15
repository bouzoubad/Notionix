import type { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { MAIN_WORKSPACE, type WorkspaceInfo } from '../../src/shared/collab'
import type { User } from './auth'
import { openWorkspace, type Workspace } from './workspace'

export class WorkspaceError extends Error {}

const MAX_NAME = 80

interface WorkspaceRow {
  id: string
  name: string
  icon: string | null
  archived_at: number | null
}

/**
 * The server's workspaces. The main one keeps the data directory's
 * workspace.db and assets (as before workspaces existed) and is open to every
 * account; the others live in workspaces/<id>/ and are open to their members
 * and to administrators.
 */
export class Workspaces {
  private readonly opened = new Map<string, Workspace>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly dataDir: string,
    private readonly now: () => number = Date.now,
    /** Called on each workspace when it is opened */
    private readonly configure: (workspace: Workspace) => void = () => undefined
  ) {}

  get main(): Workspace {
    return this.get(MAIN_WORKSPACE)!
  }

  /** The workspace's data, opened on first use; null for an unknown id. */
  get(id: string): Workspace | null {
    const open = this.opened.get(id)
    if (open) return open
    if (!this.row(id)) return null
    const dir = id === MAIN_WORKSPACE ? this.dataDir : join(this.dataDir, 'workspaces', id)
    mkdirSync(dir, { recursive: true })
    const workspace = openWorkspace(dir)
    this.configure(workspace)
    this.opened.set(id, workspace)
    return workspace
  }

  /** Every workspace, opened. */
  all(): { id: string; workspace: Workspace }[] {
    return this.rows().map((r) => ({ id: r.id, workspace: this.get(r.id)! }))
  }

  list(): WorkspaceInfo[] {
    const members = new Map<string, string[]>()
    const rows = this.db.prepare('SELECT workspace_id, user_id FROM workspace_members').all() as {
      workspace_id: string
      user_id: string
    }[]
    for (const r of rows)
      members.set(r.workspace_id, [...(members.get(r.workspace_id) ?? []), r.user_id])
    return this.rows().map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      memberIds: r.id === MAIN_WORKSPACE ? null : (members.get(r.id) ?? []),
      archived: r.archived_at !== null
    }))
  }

  /** The workspaces a person can open. */
  forUser(user: User): WorkspaceInfo[] {
    return this.list().filter((w) => this.allows(user, w))
  }

  canUse(user: User, id: string): boolean {
    const info = this.list().find((w) => w.id === id)
    return !!info && this.allows(user, info)
  }

  /** The accounts working in a workspace: all of them in the main one. */
  members(id: string, users: User[]): User[] {
    const info = this.list().find((w) => w.id === id)
    if (!info) return []
    return users.filter((u) => this.allows(u, info))
  }

  /** The workspace holding a page (page ids are unique across workspaces). */
  findPage(pageId: string): { id: string; workspace: Workspace } | null {
    for (const entry of this.all()) if (entry.workspace.pages.get(pageId)) return entry
    return null
  }

  create(name: string, icon: string | null, memberIds: string[]): WorkspaceInfo {
    const id = `ws_${randomBytes(9).toString('base64url')}`
    this.db
      .prepare('INSERT INTO workspaces (id, name, icon, created_at) VALUES (?, ?, ?, ?)')
      .run(id, workspaceName(name), icon, this.now())
    this.setMembers(id, memberIds)
    return this.list().find((w) => w.id === id)!
  }

  update(
    id: string,
    patch: { name?: string; icon?: string | null; memberIds?: string[] }
  ): WorkspaceInfo {
    if (!this.row(id)) throw new WorkspaceError('Espace introuvable.')
    if (patch.name !== undefined)
      this.db
        .prepare('UPDATE workspaces SET name = ? WHERE id = ?')
        .run(workspaceName(patch.name), id)
    if (patch.icon !== undefined)
      this.db.prepare('UPDATE workspaces SET icon = ? WHERE id = ?').run(patch.icon, id)
    if (patch.memberIds !== undefined && id !== MAIN_WORKSPACE) this.setMembers(id, patch.memberIds)
    return this.list().find((w) => w.id === id)!
  }

  /** Archived: its members no longer see it; administrators can restore it. */
  setArchived(id: string, archived: boolean): WorkspaceInfo {
    if (id === MAIN_WORKSPACE) throw new WorkspaceError('L’espace principal ne s’archive pas.')
    if (!this.row(id)) throw new WorkspaceError('Espace introuvable.')
    this.db
      .prepare('UPDATE workspaces SET archived_at = ? WHERE id = ?')
      .run(archived ? this.now() : null, id)
    return this.list().find((w) => w.id === id)!
  }

  /**
   * Deletes a workspace. Its files are not erased: they move to
   * deleted-workspaces/ in the data directory, where an administrator of the
   * machine can still recover them.
   */
  remove(id: string): string {
    if (id === MAIN_WORKSPACE) throw new WorkspaceError('L’espace principal ne se supprime pas.')
    if (!this.row(id)) throw new WorkspaceError('Espace introuvable.')
    this.opened.get(id)?.db.close()
    this.opened.delete(id)
    const dir = join(this.dataDir, 'workspaces', id)
    const kept = join(this.dataDir, 'deleted-workspaces', `${id}-${this.now()}`)
    if (existsSync(dir)) {
      mkdirSync(join(this.dataDir, 'deleted-workspaces'), { recursive: true })
      renameSync(dir, kept)
    }
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    return kept
  }

  /** Bytes of the workspace's database, and its stored files. */
  usage(id: string): { databaseBytes: number; files: number; fileBytes: number } {
    const dir = id === MAIN_WORKSPACE ? this.dataDir : join(this.dataDir, 'workspaces', id)
    const size = (file: string): number => (existsSync(file) ? statSync(file).size : 0)
    const databaseBytes = ['', '-wal', '-shm'].reduce(
      (n, suffix) => n + size(join(dir, `workspace.db${suffix}`)),
      0
    )
    let files = 0
    let fileBytes = 0
    const assets = join(dir, 'assets')
    if (existsSync(assets))
      for (const name of readdirSync(assets)) {
        files += 1
        fileBytes += size(join(assets, name))
      }
    return { databaseBytes, files, fileBytes }
  }

  /** Bytes of the server's own database (accounts, shared documents, audit). */
  serverDatabaseBytes(): number {
    return ['', '-wal', '-shm'].reduce((n, suffix) => {
      const file = join(this.dataDir, `notionix-server.db${suffix}`)
      return n + (existsSync(file) ? statSync(file).size : 0)
    }, 0)
  }

  close(): void {
    for (const workspace of this.opened.values()) workspace.db.close()
    this.opened.clear()
  }

  private allows(user: User, info: WorkspaceInfo): boolean {
    if (user.role === 'admin') return true
    return !info.archived && (info.memberIds === null || info.memberIds.includes(user.id))
  }

  private row(id: string): WorkspaceRow | undefined {
    return this.db
      .prepare('SELECT id, name, icon, archived_at FROM workspaces WHERE id = ?')
      .get(id) as WorkspaceRow | undefined
  }

  private rows(): WorkspaceRow[] {
    // The main workspace first, then by name.
    return this.db
      .prepare(`SELECT id, name, icon, archived_at FROM workspaces ORDER BY id != 'main', name`)
      .all() as unknown as WorkspaceRow[]
  }

  private setMembers(id: string, memberIds: string[]): void {
    this.db.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(id)
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id)
       SELECT ?, id FROM users WHERE id = ?`
    )
    for (const userId of new Set(memberIds)) insert.run(id, userId)
  }
}

function workspaceName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new WorkspaceError('Nom d’espace requis.')
  if (trimmed.length > MAX_NAME) throw new WorkspaceError('Nom d’espace trop long.')
  return trimmed
}
