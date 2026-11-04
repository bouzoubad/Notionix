import { Server } from '@hocuspocus/server'
import type { DatabaseSync } from 'node:sqlite'
import { Accounts } from './auth'
import { cookieToken, createApi } from './api'
import {
  announceChange,
  announceInbox,
  authenticate,
  PageDocuments,
  type CollabContext
} from './collab'
import { CallContext, type LiveDocuments } from './rpc'
import { docHasMention, docMentionedPeople } from '../../src/core/db/text'
import { reminderKey } from '../../src/core/db/teamRepository'
import type { Config } from './config'
import { MAIN_WORKSPACE, WORKSPACE_DOCUMENT } from '../../src/shared/collab'
import { exportPagesAsMarkdown } from '../../src/core/transfer/markdownExport'
import { GitMirror, type MirrorFiles } from './mirror'
import { publishReleaseNotes, releasePagesContent } from './announcements'
import { documentSchema } from '../../src/core/transfer/canonicalDoc'
import { RELEASE_NOTES } from '../../src/shared/changelog'
import type { User } from './auth'
import { openDatabase } from './db'
import { createStatic } from './static'
import { createDownloads } from './downloads'
import type { Workspace } from './workspace'
import { Workspaces } from './workspaces'
import { Groups } from './groups'
import { AuditLog } from './audit'

/** Author of the changes the server makes by itself (recurring templates). */
const SYSTEM_USER = {
  id: 'system',
  email: '',
  name: 'Notionix',
  role: 'guest' as const,
  disabled: false,
  createdAt: 0,
  groups: [],
  mustChangePassword: false
}

/**
 * Who the Git mirror reads the pages as: a reader of the main workspace with
 * nothing shared, so only the pages open to the whole workspace go into it.
 */
const MIRROR_VIEWER: User = {
  id: 'notionix-mirror',
  email: '',
  name: 'Miroir',
  role: 'reader',
  disabled: false,
  createdAt: 0,
  groups: [],
  mustChangePassword: false
}

/**
 * Folder of each workspace in the Git mirror: pages/ for the main one,
 * espaces/<name>/ for the others (a name used twice gets its id).
 */
export function mirrorFolders(list: { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>()
  const safe = (name: string): string =>
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 80) || 'Espace'
  const counts = new Map<string, number>()
  for (const w of list)
    if (w.id !== MAIN_WORKSPACE) counts.set(safe(w.name), (counts.get(safe(w.name)) ?? 0) + 1)
  for (const w of list) {
    if (w.id === MAIN_WORKSPACE) out.set(w.id, 'pages')
    else {
      const name = safe(w.name)
      out.set(w.id, `espaces/${(counts.get(name) ?? 0) > 1 ? `${name} (${w.id})` : name}`)
    }
  }
  return out
}

export interface NotionixServer {
  server: Server<CollabContext>
  accounts: Accounts
  db: DatabaseSync
  /** The main workspace */
  workspace: Workspace
  workspaces: Workspaces
  groups: Groups
  url: string
  stop: () => Promise<void>
}

/** Starts the web client, the HTTP API and the real-time sync on one port. */
export async function startServer(config: Config): Promise<NotionixServer> {
  const db = openDatabase(config.dataDir)
  const accounts = new Accounts(db, config.sessionDays)
  // Formulas name people (.name(), .email()) from the accounts.
  const workspaces = new Workspaces(db, config.dataDir, Date.now, (ws) => {
    ws.databases.personOf = (id) => accounts.byId(id) ?? undefined
  })
  const workspace = workspaces.main
  const groups = new Groups(db)
  const audit = new AuditLog(db)
  if (accounts.count() === 0 && config.adminEmail && config.adminPassword) {
    await accounts.create({
      email: config.adminEmail,
      name: 'Administrateur',
      role: 'admin',
      password: config.adminPassword
    })
    console.log(`Compte administrateur créé : ${config.adminEmail}`)
  }
  // Assigned below: the API and the real-time side refer to each other.
  let server: Server<CollabContext> | null = null
  const notifyUsers = (ids: string[]): void => {
    if (server && ids.length) announceInbox(server.hocuspocus, ids)
  }
  const live: LiveDocuments = {
    replaceContent: async (pageId, content, user) => {
      if (server) await documents.replace(server.hocuspocus, pageId, content, user)
    },
    notifyUsers
  }
  // The Git mirror of the pages open to a whole workspace (Administration > Miroir git):
  // the main workspace in pages/, the others in espaces/<name>/.
  const mirror = new GitMirror(config.mirrorDir, {
    snapshot: async () => {
      if (server) documents.projectOpenPages(server.hocuspocus)
      const out: MirrorFiles = new Map()
      const folders = mirrorFolders(workspaces.list().filter((w) => !w.archived))
      for (const [id, folder] of folders) {
        const ws = workspaces.get(id)
        if (!ws) continue
        const ctx = new CallContext(ws, MIRROR_VIEWER, () => accounts.list())
        const { files, attachments } = await exportPagesAsMarkdown(
          ctx.filter(ws.pages.list()),
          (pageId) => (ctx.level(pageId) === 'none' ? null : ws.pages.get(pageId)),
          (src) => ws.assets.read(src),
          null,
          (dbId) => (ctx.level(dbId) === 'none' ? null : ws.databases.get(dbId)),
          ctx.people()
        )
        for (const f of files) out.set(`${folder}/${f.path}`, f.markdown)
        for (const a of attachments) out.set(`${folder}/${a.path}`, a.bytes)
      }
      return out
    },
    person: (id) => {
      const user = accounts.byId(id)
      return user ? { name: user.name, email: user.email } : null
    }
  })
  // Changes made while the server was stopped: exported soon after it starts.
  if (mirror.status().configured) mirror.touch(null)
  // Edits of a shared page: activity, and a notice to the people newly mentioned.
  const documents = new PageDocuments(db, workspaces, (workspace, pageId, before, actorId) => {
    mirror.touch(actorId)
    const actor = actorId ? accounts.byId(actorId) : null
    if (!actor) return
    const ctx = new CallContext(workspace, actor, () => accounts.list(), live)
    ctx.log(pageId, 'edited')
    const after = workspace.pages.get(pageId)?.content ?? ''
    const known = new Set(docMentionedPeople(before))
    const added = docMentionedPeople(after).filter((u) => !known.has(u))
    if (added.length)
      ctx.notify(added, {
        kind: 'mention',
        pageId,
        text: `${actor.name} vous a mentionné dans « ${workspace.pages.summary(pageId).title || 'Sans titre'} ».`
      })
  })
  const api = createApi({
    accounts,
    workspaces,
    groups,
    sessionDays: config.sessionDays,
    mirror,
    collab: {
      flush: () => server && documents.projectOpenPages(server.hocuspocus),
      ...live,
      online: () => {
        const channel = server?.hocuspocus.documents.get(WORKSPACE_DOCUMENT)
        return (channel?.getConnections() ?? []).flatMap((c) => {
          const id = (c.context as CollabContext | undefined)?.user?.id
          return id ? [id] : []
        })
      },
      changed: (user, workspaceId) => {
        mirror.touch(user.id === SYSTEM_USER.id ? null : user.id)
        if (!server) return
        documents.forgetDeletedPages(server.hocuspocus)
        announceChange(server.hocuspocus, user, workspaceId)
      }
    }
  })
  const serveStatic = createStatic(config.webDir)
  const downloads = createDownloads(config.downloadsDir, config.plainPort)
  server = new Server<CollabContext>({
    port: config.port,
    address: config.host,
    quiet: true,
    stopOnSignals: false,
    // Pages are small; this bounds a single message (images go through the HTTP API).
    websocketOptions: { maxPayload: 16 * 1024 * 1024 },
    extensions: [documents.extension()],
    onAuthenticate: authenticate(accounts, workspaces, (headers) =>
      cookieToken(headers.get('cookie'))
    ),
    async onRequest({ request, response }) {
      // A thrown null tells Hocuspocus the request is answered.
      if (await downloads(request, response)) throw null
      if (await api(request, response)) throw null
      if (await serveStatic(request, response)) throw null
    }
  })
  await server.listen()
  // What changed since the last version: a page each, and a notification to everyone.
  if (config.releaseNotes) {
    try {
      const news = publishReleaseNotes(db, workspaces.main, RELEASE_NOTES, () => accounts.list())
      // The pages as they must be (the list of notes, their text), put back when they differ.
      const schema = documentSchema()
      // Compared block by block, without the empty paragraph the editor adds at the end.
      const blocks = (content: string): string => {
        const json = schema.nodeFromJSON(JSON.parse(content)).toJSON() as {
          content?: { type: string; content?: unknown[] }[]
        }
        const list = [...(json.content ?? [])]
        while (list.length && list.at(-1)!.type === 'paragraph' && !list.at(-1)!.content?.length)
          list.pop()
        return JSON.stringify(list)
      }
      const same = (a: string, b: string): boolean => blocks(a) === blocks(b)
      let repaired = 0
      for (const { pageId, content } of releasePagesContent(db, RELEASE_NOTES)) {
        const page = workspaces.main.pages.get(pageId)
        if (!page || same(page.content, content)) continue
        await documents.replace(server.hocuspocus, pageId, content, SYSTEM_USER)
        repaired++
      }
      if (news.published.length || repaired) {
        announceChange(server.hocuspocus, SYSTEM_USER, MAIN_WORKSPACE)
        mirror.touch(null)
      }
      if (news.published.length) {
        notifyUsers(news.notified)
        console.log(`Nouveautés publiées : ${news.published.join(', ')}`)
      }
    } catch (e) {
      console.error('Nouveautés non publiées :', e)
    }
  }
  // Every hour: expired sessions, and pages in the trash for more than 30 days.
  const purgeTrash = (): void => {
    let purged = 0
    for (const { workspace } of workspaces.all()) purged += workspace.pages.purgeTrash()
    if (purged > 0 && server) documents.forgetDeletedPages(server.hocuspocus)
  }
  const purge = setInterval(
    () => {
      accounts.purgeExpired()
      audit.purge()
      purgeTrash()
    },
    60 * 60 * 1000
  )
  purgeTrash()
  purge.unref()
  // Reminders become notifications when their time comes.
  const reminders = setInterval(() => {
    for (const { id, workspace } of workspaces.all()) {
      // Recurring templates due: their rows, announced like any change.
      const changed = workspace.databases.runDueRecurrences()
      if (changed.length && server) announceChange(server.hocuspocus, SYSTEM_USER, id)
      if (changed.length) mirror.touch(null)
      const due = workspace.team
        .takeDueReminders()
        .filter((r) => docHasMention(workspace.pages.get(r.pageId)?.content ?? '', reminderKey(r)))
      for (const r of due)
        workspace.team.notify([r.userId], {
          kind: 'reminder',
          pageId: r.pageId,
          actorId: null,
          text: r.text
        })
      notifyUsers([...new Set(due.map((r) => r.userId))])
    }
  }, config.reminderIntervalMs)
  reminders.unref()
  const { port } = server.address
  const running = server
  return {
    server: running,
    accounts,
    db,
    workspace,
    workspaces,
    groups,
    url: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${port}`,
    stop: async () => {
      clearInterval(purge)
      clearInterval(reminders)
      running.hocuspocus.flushPendingStores()
      await mirror.stop()
      await running.destroy()
      workspaces.close()
      db.close()
    }
  }
}
