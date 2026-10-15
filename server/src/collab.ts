import type { DatabaseSync } from 'node:sqlite'
import type { Extension, Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { documentSchema } from '../../src/core/transfer/canonicalDoc'
import { PAGE_FIELD, WORKSPACE_DOCUMENT, pageIdOf } from '../../src/shared/collab'
import type { Accounts, User } from './auth'
import type { Workspace } from './workspace'

export interface CollabContext {
  user: User
}

/**
 * Page documents in SQLite: the Yjs state is the source of truth for a page's
 * content once it has been opened; every store also writes the page's JSON
 * back to the workspace, so search, export and duplication see it.
 */
export class PageDocuments {
  constructor(
    private readonly store: DatabaseSync,
    private readonly workspace: Workspace
  ) {}

  extension(): Extension {
    return {
      onLoadDocument: async ({ documentName, document }) => this.load(documentName, document),
      onStoreDocument: async ({ documentName, document }) => this.save(documentName, document)
    }
  }

  private load(name: string, document: Y.Doc): void {
    const id = pageIdOf(name)
    if (!id) return
    const row = this.store.prepare('SELECT state FROM documents WHERE name = ?').get(name) as
      { state: Uint8Array } | undefined
    if (row) {
      Y.applyUpdate(document, new Uint8Array(row.state))
      return
    }
    // First opening: the document starts from the content stored in the workspace.
    const page = this.workspace.pages.get(id)
    if (!page) return
    const seeded = prosemirrorJSONToYDoc(documentSchema(), JSON.parse(page.content), PAGE_FIELD)
    Y.applyUpdate(document, Y.encodeStateAsUpdate(seeded))
  }

  private save(name: string, document: Y.Doc): void {
    // A page deleted while open is stored once more when its editors leave: dropped.
    const id = pageIdOf(name)
    if (!id || !this.workspace.pages.get(id)) return
    this.store
      .prepare(
        `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
      )
      .run(name, Y.encodeStateAsUpdate(document), Date.now())
    this.project(name, document)
  }

  /** Writes a page document's content to the workspace when it differs. */
  private project(name: string, document: Y.Doc): void {
    const id = pageIdOf(name)
    const page = id ? this.workspace.pages.get(id) : null
    if (!id || !page) return
    const root = yXmlFragmentToProseMirrorRootNode(
      document.getXmlFragment(PAGE_FIELD),
      documentSchema()
    )
    const content = JSON.stringify(root.toJSON())
    if (content !== page.content) this.workspace.pages.update(id, { content })
  }

  /** Brings the workspace up to date with the pages being edited right now. */
  projectOpenPages(instance: Hocuspocus): void {
    for (const [name, document] of instance.documents) this.project(name, document)
  }

  /** Drops the documents of pages that no longer exist, and disconnects their editors. */
  forgetDeletedPages(instance: Hocuspocus): void {
    const stored = this.store
      .prepare("SELECT name FROM documents WHERE name LIKE 'page:%'")
      .all() as { name: string }[]
    const names = new Set([...stored.map((r) => r.name), ...instance.documents.keys()])
    for (const name of names) {
      const id = pageIdOf(name)
      if (!id || this.workspace.pages.get(id)) continue
      instance.closeConnections(name)
      this.store.prepare('DELETE FROM documents WHERE name = ?').run(name)
    }
  }
}

/** Tells every connected client that pages or databases changed. */
export function announceChange(instance: Hocuspocus, by: User): void {
  instance.documents
    .get(WORKSPACE_DOCUMENT)
    ?.broadcastStateless(JSON.stringify({ type: 'changed', by: by.id }))
}

/**
 * Checks the session of a WebSocket connection: the token sent by the client,
 * or the web client's session cookie. Readers get a read-only connection.
 */
export function authenticate(
  accounts: Accounts,
  workspace: Workspace,
  cookieToken: (headers: Headers) => string | null
) {
  return async ({
    token,
    documentName,
    requestHeaders,
    connectionConfig
  }: {
    token: string
    documentName: string
    requestHeaders: Headers
    connectionConfig: { readOnly: boolean }
  }): Promise<CollabContext> => {
    const id = pageIdOf(documentName)
    if (documentName !== WORKSPACE_DOCUMENT && id === null) throw new Error('Document inconnu.')
    const user = accounts.authenticate(token) ?? accounts.authenticate(cookieToken(requestHeaders))
    if (!user) throw new Error('Session invalide ou expirée.')
    if (id !== null && !workspace.pages.get(id)) throw new Error('Page introuvable.')
    // The workspace channel only carries the server's notices.
    if (user.role === 'reader' || id === null) connectionConfig.readOnly = true
    return { user }
  }
}
