import type { DatabaseSync } from 'node:sqlite'
import { markdownToDoc, newStats } from '../../src/core/transfer/markdownToDoc'
import type { ReleaseNote } from '../../src/shared/changelog'
import type { PageId } from '../../src/shared/types'
import type { Workspace } from './workspace'

/** The page holding the release notes, kept as the entry with this id. */
const PARENT = '_page'

const INTRO = `Ce qui change dans Notionix, du plus récent au plus ancien. Chaque nouveauté arrive aussi dans votre boîte de réception.`

const doc = (markdown: string): string =>
  JSON.stringify(markdownToDoc(markdown, () => undefined, newStats()))

const frenchDate = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

/**
 * Publishes the release notes the server has not published yet: one page
 * each, newest first, under « Nouveautés de Notionix » (main workspace, open
 * to everyone, locked), and a notification to every active account. Returns
 * who was notified, to tell their open apps.
 */
export function publishReleaseNotes(
  db: DatabaseSync,
  workspace: Workspace,
  notes: ReleaseNote[],
  accounts: () => { id: string; disabled: boolean }[]
): { published: string[]; notified: string[] } {
  const done = new Map(
    (
      db.prepare('SELECT id, page_id FROM announcements').all() as { id: string; page_id: string }[]
    ).map((r) => [r.id, r.page_id])
  )
  const fresh = notes.filter((n) => !done.has(n.id)).reverse()
  if (fresh.length === 0) return { published: [], notified: [] }
  const record = db.prepare(
    'INSERT OR REPLACE INTO announcements (id, page_id, at) VALUES (?, ?, ?)'
  )
  const pages = workspace.pages
  return pages.as(null, () => {
    let parent: PageId | null = done.get(PARENT) ?? null
    const live = parent ? pages.get(parent) : null
    if (!live || live.trashedAt !== null) {
      const page = pages.createWith(null, {
        title: 'Nouveautés de Notionix',
        icon: '📣',
        content: doc(INTRO),
        access: 'workspace'
      })
      pages.update(page.id, { options: { ...page.options, locked: true } })
      parent = page.id
      record.run(PARENT, parent, Date.now())
    }
    const people = accounts()
      .filter((a) => !a.disabled)
      .map((a) => a.id)
    for (const note of fresh) {
      const page = pages.createWith(parent, {
        title: `${frenchDate(note.date)} — ${note.title}`,
        icon: '✨',
        content: doc(note.body)
      })
      pages.update(page.id, { options: { ...page.options, locked: true } })
      // Newest first.
      pages.move(page.id, parent, 0)
      workspace.team.notify(people, {
        kind: 'news',
        pageId: page.id,
        actorId: null,
        text: `Nouveautés : ${note.summary}`
      })
      record.run(note.id, page.id, Date.now())
    }
    return { published: fresh.map((n) => n.id), notified: people }
  })
}
