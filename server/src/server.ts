import { Server } from '@hocuspocus/server'
import type { DatabaseSync } from 'node:sqlite'
import { Accounts } from './auth'
import { createApi } from './api'
import { ServerAssets } from './assets'
import { authenticate, documentStore, type CollabContext } from './collab'
import type { Config } from './config'
import { openDatabase } from './db'

export interface NotionixServer {
  server: Server<CollabContext>
  accounts: Accounts
  db: DatabaseSync
  url: string
  stop: () => Promise<void>
}

/** Starts the HTTP API and the real-time sync on one port. */
export async function startServer(config: Config): Promise<NotionixServer> {
  const db = openDatabase(config.dataDir)
  const accounts = new Accounts(db, config.sessionDays)
  if (accounts.count() === 0 && config.adminEmail && config.adminPassword) {
    await accounts.create({ email: config.adminEmail, name: 'Administrateur', role: 'admin', password: config.adminPassword })
    console.log(`Compte administrateur créé : ${config.adminEmail}`)
  }
  const api = createApi(accounts, new ServerAssets(config.dataDir))
  const server = new Server<CollabContext>({
    port: config.port,
    address: config.host,
    quiet: true,
    stopOnSignals: false,
    // Pages are small; this bounds a single message (images go through the HTTP API).
    websocketOptions: { maxPayload: 16 * 1024 * 1024 },
    extensions: [documentStore(db)],
    onAuthenticate: authenticate(accounts),
    async onRequest({ request, response }) {
      if (await api(request, response)) throw null // handled: skip Hocuspocus' default reply
    }
  })
  await server.listen()
  const purge = setInterval(() => accounts.purgeExpired(), 60 * 60 * 1000)
  purge.unref()
  const { port } = server.address
  return {
    server,
    accounts,
    db,
    url: `http://${config.host}:${port}`,
    stop: async () => {
      clearInterval(purge)
      server.hocuspocus.flushPendingStores()
      await server.destroy()
      db.close()
    }
  }
}
