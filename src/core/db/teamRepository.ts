import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'crypto'
import type {
  ActivityItem,
  ActivityKind,
  Comment,
  InboxItem,
  InboxKind,
  NewComment,
  PageId
} from '../../shared/types'

interface CommentRow {
  id: string
  page_id: string
  thread_id: string
  author_id: string | null
  body: string
  mentions: string | null
  quote: string | null
  created_at: number
  edited_at: number | null
  resolved_at: number | null
}

interface NotificationRow {
  id: string
  kind: string
  page_id: string | null
  actor_id: string | null
  text: string
  ref: string | null
  created_at: number
  read_at: number | null
}

const ids = (raw: string | null): string[] => {
  try {
    const v = JSON.parse(raw ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const toComment = (r: CommentRow): Comment => ({
  id: r.id,
  pageId: r.page_id,
  threadId: r.thread_id,
  authorId: r.author_id,
  body: r.body,
  mentions: ids(r.mentions),
  quote: r.quote,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  resolvedAt: r.resolved_at
})

const toItem = (r: NotificationRow): InboxItem => ({
  id: r.id,
  kind: r.kind as InboxKind,
  pageId: r.page_id,
  actorId: r.actor_id,
  text: r.text,
  ref: r.ref,
  createdAt: r.created_at,
  readAt: r.read_at
})

export const MAX_COMMENT_LENGTH = 10_000
/** Edits of a page by the same person within this delay are one activity entry. */
const EDIT_ACTIVITY_WINDOW_MS = 10 * 60 * 1000

/** The key a reminder was set with (a date mention's id). */
export const reminderKey = (r: { id: string; userId: string }): string =>
  r.id.slice(r.userId.length + 1)

/** Due reminder, sent once. */
export interface DueReminder {
  id: string
  userId: string
  pageId: PageId
  text: string
  at: number
}

/**
 * Comments, notifications, activity and reminders of a workspace. Access
 * checks belong to the callers; this only stores and reads.
 */
export class TeamRepository {
  constructor(
    readonly db: DatabaseSync,
    readonly now: () => number = Date.now
  ) {}

  // -------------------------------------------------------------------------
  // Comments

  comments(pageId: PageId): Comment[] {
    return (
      this.db
        .prepare('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at, rowid')
        .all(pageId) as unknown as CommentRow[]
    ).map(toComment)
  }

  comment(id: string): Comment | null {
    const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as
      CommentRow | undefined
    return row ? toComment(row) : null
  }

  thread(threadId: string): Comment[] {
    return (
      this.db
        .prepare('SELECT * FROM comments WHERE thread_id = ? ORDER BY created_at, rowid')
        .all(threadId) as unknown as CommentRow[]
    ).map(toComment)
  }

  addComment(pageId: PageId, authorId: string | null, input: NewComment): Comment {
    const body = checkBody(input.body)
    const first = input.threadId ? this.thread(input.threadId)[0] : undefined
    if (input.threadId && first && first.pageId !== pageId)
      throw new Error('Discussion introuvable.')
    const id = randomUUID()
    // A reply keeps the thread's quote; a new thread may quote the page.
    const threadId = input.threadId ?? randomUUID()
    const quote = first ? first.quote : (input.quote?.slice(0, 1000) ?? null)
    this.db
      .prepare(
        `INSERT INTO comments (id, page_id, thread_id, author_id, body, mentions, quote, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        pageId,
        threadId,
        authorId,
        body,
        JSON.stringify(input.mentions ?? []),
        quote,
        this.now()
      )
    // Answering a resolved discussion opens it again.
    this.db.prepare('UPDATE comments SET resolved_at = NULL WHERE thread_id = ?').run(threadId)
    return this.comment(id)!
  }

  updateComment(id: string, body: string, mentions: string[]): Comment {
    const res = this.db
      .prepare('UPDATE comments SET body = ?, mentions = ?, edited_at = ? WHERE id = ?')
      .run(checkBody(body), JSON.stringify(mentions), this.now(), id)
    if (res.changes === 0) throw new Error('Commentaire introuvable.')
    return this.comment(id)!
  }

  removeComment(id: string): void {
    this.db.prepare('DELETE FROM comments WHERE id = ?').run(id)
  }

  resolveThread(threadId: string, resolved: boolean): void {
    this.db
      .prepare('UPDATE comments SET resolved_at = ? WHERE thread_id = ?')
      .run(resolved ? this.now() : null, threadId)
  }

  // -------------------------------------------------------------------------
  // Notifications

  notify(
    userIds: Iterable<string>,
    item: {
      kind: InboxKind
      pageId: PageId | null
      actorId: string | null
      text: string
      ref?: string | null
    }
  ): string[] {
    const insert = this.db.prepare(
      `INSERT INTO notifications (id, user_id, kind, page_id, actor_id, text, ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const sent: string[] = []
    for (const userId of new Set(userIds)) {
      if (userId === item.actorId) continue
      insert.run(
        randomUUID(),
        userId,
        item.kind,
        item.pageId,
        item.actorId,
        item.text,
        item.ref ?? null,
        this.now()
      )
      sent.push(userId)
    }
    return sent
  }

  inbox(userId: string, limit = 100): InboxItem[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
        )
        .all(userId, limit) as unknown as NotificationRow[]
    ).map(toItem)
  }

  markRead(userId: string, ids: string[] | null): void {
    const t = this.now()
    if (ids === null) {
      this.db
        .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
        .run(t, userId)
      return
    }
    const stmt = this.db.prepare(
      'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL'
    )
    for (const id of ids) stmt.run(t, id, userId)
  }

  // -------------------------------------------------------------------------
  // Activity

  log(
    pageId: PageId,
    actorId: string | null,
    kind: ActivityKind,
    detail: string | null = null
  ): void {
    const t = this.now()
    if (kind === 'edited') {
      const last = this.db
        .prepare(
          `SELECT id FROM activity WHERE page_id = ? AND actor_id IS ? AND kind = 'edited' AND at > ?
           ORDER BY id DESC LIMIT 1`
        )
        .get(pageId, actorId, t - EDIT_ACTIVITY_WINDOW_MS) as { id: number } | undefined
      if (last) {
        this.db.prepare('UPDATE activity SET at = ? WHERE id = ?').run(t, last.id)
        return
      }
    }
    this.db
      .prepare('INSERT INTO activity (page_id, actor_id, kind, detail, at) VALUES (?, ?, ?, ?, ?)')
      .run(pageId, actorId, kind, detail, t)
  }

  activity(limit = 200): ActivityItem[] {
    return (
      this.db.prepare('SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT ?').all(limit) as {
        id: number
        page_id: string
        actor_id: string | null
        kind: ActivityKind
        detail: string | null
        at: number
      }[]
    ).map((r) => ({
      id: r.id,
      pageId: r.page_id,
      actorId: r.actor_id,
      kind: r.kind,
      detail: r.detail,
      at: r.at
    }))
  }

  // -------------------------------------------------------------------------
  // Reminders

  setReminder(userId: string, pageId: PageId, key: string, at: number | null, text: string): void {
    const id = `${userId}:${key}`.slice(0, 200)
    if (at === null) {
      this.db.prepare('DELETE FROM reminders WHERE id = ?').run(id)
      return
    }
    this.db
      .prepare(
        `INSERT INTO reminders (id, user_id, page_id, at, text) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET at = excluded.at, text = excluded.text, page_id = excluded.page_id,
           sent_at = CASE WHEN excluded.at = reminders.at THEN reminders.sent_at ELSE NULL END`
      )
      .run(id, userId, pageId, at, text.slice(0, 500))
  }

  /** Reminders whose time has come, marked sent so they are delivered once. */
  takeDueReminders(): DueReminder[] {
    const t = this.now()
    const due = this.db
      .prepare(
        'SELECT id, user_id, page_id, text, at FROM reminders WHERE sent_at IS NULL AND at <= ?'
      )
      .all(t) as { id: string; user_id: string; page_id: string; text: string; at: number }[]
    const mark = this.db.prepare('UPDATE reminders SET sent_at = ? WHERE id = ?')
    for (const r of due) mark.run(t, r.id)
    return due.map((r) => ({
      id: r.id,
      userId: r.user_id,
      pageId: r.page_id,
      text: r.text,
      at: r.at
    }))
  }
}

function checkBody(body: unknown): string {
  if (typeof body !== 'string' || !body.trim()) throw new Error('Commentaire vide.')
  if (body.length > MAX_COMMENT_LENGTH) throw new Error('Commentaire trop long.')
  return body.trim()
}
