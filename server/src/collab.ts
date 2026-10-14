import type { DatabaseSync } from 'node:sqlite'
import { Database } from '@hocuspocus/extension-database'
import type { Accounts, User } from './auth'

/** Shared documents: the workspace (page tree, titles, databases) and one per page. */
export const DOCUMENT_NAME = /^(workspace|page):[A-Za-z0-9_-]{1,64}$/

export interface CollabContext {
  user: User
}

/** Persists every Yjs document as its full state in SQLite. */
export function documentStore(db: DatabaseSync): Database {
  return new Database({
    fetch: async ({ documentName }) => {
      const row = db.prepare('SELECT state FROM documents WHERE name = ?').get(documentName) as
        | { state: Uint8Array }
        | undefined
      return row ? new Uint8Array(row.state) : null
    },
    store: async ({ documentName, state }) => {
      db.prepare(
        `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
      ).run(documentName, state, Date.now())
    }
  })
}

/**
 * Checks the session token of a WebSocket connection. Readers get a
 * read-only connection: the server ignores their changes.
 */
export function authenticate(accounts: Accounts) {
  return async ({
    token,
    documentName,
    connectionConfig
  }: {
    token: string
    documentName: string
    connectionConfig: { readOnly: boolean }
  }): Promise<CollabContext> => {
    if (!DOCUMENT_NAME.test(documentName)) throw new Error('Document inconnu.')
    const user = accounts.authenticate(token)
    if (!user) throw new Error('Session invalide ou expirée.')
    if (user.role === 'reader') connectionConfig.readOnly = true
    return { user }
  }
}
