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
import { openDatabase } from './db'
import { createStatic } from './static'
import { openWorkspace, type Workspace } from './workspace'

export interface NotionixServer {
  server: Server<CollabContext>
  accounts: Accounts
  db: DatabaseSync
  workspace: Workspace
  url: string
  stop: () => Promise<void>
}

/** Starts the web client, the HTTP API and the real-time sync on one port. */
export async function startServer(config: Config): Promise<NotionixServer> {
  const db = openDatabase(config.dataDir)
  const workspace = openWorkspace(config.dataDir)
  const accounts = new Accounts(db, config.sessionDays)
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
  // Edits of a shared page: activity, and a notice to the people newly mentioned.
  const documents = new PageDocuments(db, workspace, (pageId, before, actorId) => {
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
    workspace,
    sessionDays: config.sessionDays,
    collab: {
      flush: () => server && documents.projectOpenPages(server.hocuspocus),
      ...live,
      changed: (user) => {
        if (!server) return
        documents.forgetDeletedPages(server.hocuspocus)
        announceChange(server.hocuspocus, user)
      }
    }
  })
  const serveStatic = createStatic(config.webDir)
  server = new Server<CollabContext>({
    port: config.port,
    address: config.host,
    quiet: true,
    stopOnSignals: false,
    // Pages are small; this bounds a single message (images go through the HTTP API).
    websocketOptions: { maxPayload: 16 * 1024 * 1024 },
    extensions: [documents.extension()],
    onAuthenticate: authenticate(accounts, workspace, (headers) =>
      cookieToken(headers.get('cookie'))
    ),
    async onRequest({ request, response }) {
      // A thrown null tells Hocuspocus the request is answered.
      if (await api(request, response)) throw null
      if (await serveStatic(request, response)) throw null
    }
  })
  await server.listen()
  // Every hour: expired sessions, and pages in the trash for more than 30 days.
  const purgeTrash = (): void => {
    if (workspace.pages.purgeTrash() > 0 && server) documents.forgetDeletedPages(server.hocuspocus)
  }
  const purge = setInterval(
    () => {
      accounts.purgeExpired()
      purgeTrash()
    },
    60 * 60 * 1000
  )
  purgeTrash()
  purge.unref()
  // Reminders become notifications when their time comes.
  const reminders = setInterval(() => {
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
  }, config.reminderIntervalMs)
  reminders.unref()
  const { port } = server.address
  const running = server
  return {
    server: running,
    accounts,
    db,
    workspace,
    url: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${port}`,
    stop: async () => {
      clearInterval(purge)
      clearInterval(reminders)
      running.hocuspocus.flushPendingStores()
      await running.destroy()
      workspace.db.close()
      db.close()
    }
  }
}
