import { Server } from '@hocuspocus/server'
import type { DatabaseSync } from 'node:sqlite'
import { Accounts } from './auth'
import { cookieToken, createApi } from './api'
import { announceChange, authenticate, PageDocuments, type CollabContext } from './collab'
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
  const documents = new PageDocuments(db, workspace)
  // Assigned below: the API and the real-time side refer to each other.
  let server: Server<CollabContext> | null = null
  const api = createApi({
    accounts,
    workspace,
    sessionDays: config.sessionDays,
    collab: {
      flush: () => server && documents.projectOpenPages(server.hocuspocus),
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
  const purge = setInterval(() => accounts.purgeExpired(), 60 * 60 * 1000)
  purge.unref()
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
      running.hocuspocus.flushPendingStores()
      await running.destroy()
      workspace.db.close()
      db.close()
    }
  }
}
