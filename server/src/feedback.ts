import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'crypto'
import type { Feedback, FeedbackKind, FeedbackStatus } from '../../src/shared/collab'
import { assetNameFromSrc } from '../../src/shared/assets'

const STATUSES: FeedbackStatus[] = ['new', 'planned', 'in_progress', 'done', 'declined']

interface Row {
  id: string
  user_id: string | null
  user_name: string | null
  kind: FeedbackKind
  title: string
  body: string
  screenshot: string | null
  context: string | null
  status: FeedbackStatus
  reply: string | null
  created_at: number
  updated_at: number
}

const toFeedback = (r: Row): Feedback => {
  let context: Record<string, string> = {}
  try {
    const v = JSON.parse(r.context ?? '{}')
    if (v && typeof v === 'object') context = v
  } catch {
    context = {}
  }
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name ?? 'Compte supprimé',
    kind: r.kind,
    title: r.title,
    body: r.body,
    screenshot: r.screenshot,
    context,
    status: r.status,
    reply: r.reply,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export class FeedbackError extends Error {}

const text = (v: unknown, max: number, field: string, required = true): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (required && !s) throw new FeedbackError(`${field} manquant.`)
  if (s.length > max) throw new FeedbackError(`${field} trop long.`)
  return s
}

/** Bugs and ideas sent by the people of the workspace. */
export class FeedbackRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now
  ) {}

  private readonly select = `SELECT f.*, u.name AS user_name FROM feedback f LEFT JOIN users u ON u.id = f.user_id`

  create(userId: string, input: Record<string, unknown>): Feedback {
    const kind: FeedbackKind = input.kind === 'idea' ? 'idea' : 'bug'
    const title = text(input.title, 200, 'Titre')
    const body = text(input.body, 10_000, 'Description', false)
    const screenshot =
      typeof input.screenshot === 'string' && assetNameFromSrc(input.screenshot)
        ? input.screenshot
        : null
    // A few facts on where it happened, as plain short strings.
    const context: Record<string, string> = {}
    if (input.context && typeof input.context === 'object')
      for (const [k, v] of Object.entries(input.context as Record<string, unknown>).slice(0, 10))
        if (typeof v === 'string') context[k.slice(0, 40)] = v.slice(0, 300)
    const id = randomUUID()
    const t = this.now()
    this.db
      .prepare(
        `INSERT INTO feedback (id, user_id, kind, title, body, screenshot, context, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId, kind, title, body, screenshot, JSON.stringify(context), t, t)
    return this.get(id)!
  }

  get(id: string): Feedback | null {
    const row = this.db.prepare(`${this.select} WHERE f.id = ?`).get(id) as Row | undefined
    return row ? toFeedback(row) : null
  }

  /** Everything (administrators), or one person's own feedback. */
  list(userId: string | null): Feedback[] {
    const rows = (userId === null
      ? this.db.prepare(`${this.select} ORDER BY f.created_at DESC`).all()
      : this.db
          .prepare(`${this.select} WHERE f.user_id = ? ORDER BY f.created_at DESC`)
          .all(userId)) as unknown as Row[]
    return rows.map(toFeedback)
  }

  /** Status and answer, set by an administrator. */
  update(id: string, patch: Record<string, unknown>): Feedback {
    const current = this.get(id)
    if (!current) throw new FeedbackError('Retour introuvable.')
    const status =
      typeof patch.status === 'string' && STATUSES.includes(patch.status as FeedbackStatus)
        ? (patch.status as FeedbackStatus)
        : current.status
    const reply =
      patch.reply === undefined ? current.reply : text(patch.reply, 5000, 'Réponse', false) || null
    this.db
      .prepare('UPDATE feedback SET status = ?, reply = ?, updated_at = ? WHERE id = ?')
      .run(status, reply, this.now(), id)
    return this.get(id)!
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM feedback WHERE id = ?').run(id)
  }
}
