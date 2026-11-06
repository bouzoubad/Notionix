import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'
import type { KeptDocument } from '../web/session'
import { pageDocumentName } from '../shared/collab'

/** Copies made before 1.1.3 came from documents started anew at each opening: dropped. */
const PREFIX = 'notionix-page2:'
const OLD_PREFIXES = ['notionix-page:']

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

const deleteDatabase = (name: string): Promise<void> =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })

/** Forgets the kept documents of these pages (set to "online only"). */
export async function forgetDocuments(
  server: string,
  userId: string,
  pageIds: Iterable<string>
): Promise<void> {
  for (const id of pageIds)
    await deleteDatabase(`${PREFIX}${server}|${userId}|${pageDocumentName(id)}`)
}

/** Forgets every kept document (signing out); `old`: only the copies of earlier versions. */
export async function forgetKeptDocuments(old = false): Promise<void> {
  const databases = await indexedDB.databases().catch(() => [])
  const prefixes = old ? OLD_PREFIXES : [PREFIX, ...OLD_PREFIXES]
  await Promise.all(
    databases
      .filter((d) => prefixes.some((p) => d.name?.startsWith(p)))
      .map((d) => deleteDatabase(d.name!))
  )
}
