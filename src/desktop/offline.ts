import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'
import type { KeptDocument } from '../web/session'

const PREFIX = 'notionix-page:'

/**
 * Keeps the team's page documents on this computer (IndexedDB), per server
 * and account: a page opened once opens again without network, and what is
 * written meanwhile merges with the others' changes on reconnection.
 */
export function keepDocuments(server: string, userId: string) {
  return (name: string, document: Y.Doc): KeptDocument => {
    const persistence = new IndexeddbPersistence(`${PREFIX}${server}|${userId}|${name}`, document)
    return {
      loaded: persistence.whenSynced.then(() => undefined),
      destroy: () => void persistence.destroy()
    }
  }
}

/** Forgets every kept document (signing out). */
export async function forgetKeptDocuments(): Promise<void> {
  const databases = await indexedDB.databases().catch(() => [])
  await Promise.all(
    databases
      .filter((d) => d.name?.startsWith(PREFIX))
      .map(
        (d) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(d.name!)
            request.onsuccess = request.onerror = request.onblocked = () => resolve()
          })
      )
  )
}
