import type { DatabaseSync } from 'node:sqlite'
import type { AuditEntry } from '../../src/shared/collab'

/**
 * What administrators may need to retrace: accounts, access, sharing,
 * publication, deletions, imports and exports. Kept one year.
 */
export class AuditLog {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now
  ) {}

  record(
    actorId: string | null,
    action: string,
    target: string | null = null,
    detail: string | null = null,
    workspace: string | null = null
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit (at, actor_id, action, target, detail, workspace) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(this.now(), actorId, action, target, detail?.slice(0, 500) ?? null, workspace)
  }

  /** Newest first; `before` (an entry id) pages back. */
  list(
    filter: { action?: string; actorId?: string; before?: number; limit?: number } = {}
  ): AuditEntry[] {
    const where: string[] = []
    const args: (string | number)[] = []
    if (filter.action) {
      where.push('action = ?')
      args.push(filter.action)
    }
    if (filter.actorId) {
      where.push('actor_id = ?')
      args.push(filter.actorId)
    }
    if (filter.before !== undefined) {
      where.push('id < ?')
      args.push(filter.before)
    }
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
    return (
      this.db
        .prepare(
          `SELECT id, at, actor_id, action, target, detail, workspace FROM audit
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`
        )
        .all(...args, limit) as {
        id: number
        at: number
        actor_id: string | null
        action: string
        target: string | null
        detail: string | null
        workspace: string | null
      }[]
    ).map((r) => ({
      id: r.id,
      at: r.at,
      actorId: r.actor_id,
      action: r.action,
      target: r.target,
      detail: r.detail,
      workspace: r.workspace
    }))
  }

  purge(maxAgeMs = 365 * 864e5): void {
    this.db.prepare('DELETE FROM audit WHERE at < ?').run(this.now() - maxAgeMs)
  }
}
