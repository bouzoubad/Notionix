import type { DatabaseSync } from 'node:sqlite'
import type { Extension, Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  prosemirrorJSONToYDoc,
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode
} from '@tiptap/y-tiptap'
import { documentSchema } from '../../src/core/transfer/canonicalDoc'
import {
  PAGE_FIELD,
  WORKSPACE_DOCUMENT,
  pageDocumentName,
  pageIdOf,
  type ChangeNotice
} from '../../src/shared/collab'
import type { Accounts, User } from './auth'
import { resolveLevels } from '../../src/core/access'
import { atLeast } from '../../src/shared/types'
import type { Workspace } from './workspace'
import type { Workspaces } from './workspaces'

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
    private readonly workspaces: Workspaces,
    /** Called after a page's content was written back, with the content before */
    private readonly onChange: (
      workspace: Workspace,
      pageId: string,
      before: string,
      actorId: string | null
    ) => void = () => undefined
  ) {}

  /** The workspace holding the page of a document. */
  private workspaceOf(id: string): Workspace | null {
    return this.workspaces.findPage(id)?.workspace ?? null
  }

  /** Who last changed each open document: the author of what is written back. */
  private readonly lastEditor = new Map<string, string>()

  extension(): Extension {
    return {
      onLoadDocument: async ({ documentName, document }) => this.load(documentName, document),
      onChange: async ({ documentName, context }) => {
        const user = (context as CollabContext | undefined)?.user
        if (user) this.lastEditor.set(documentName, user.id)
      },
      onStoreDocument: async ({ documentName, document }) => this.save(documentName, document),
      afterUnloadDocument: async ({ documentName }) => {
        this.lastEditor.delete(documentName)
      }
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
    const page = this.workspaceOf(id)?.pages.get(id)
    if (!page) return
    const seeded = prosemirrorJSONToYDoc(documentSchema(), JSON.parse(page.content), PAGE_FIELD)
    Y.applyUpdate(document, Y.encodeStateAsUpdate(seeded))
  }

  private save(name: string, document: Y.Doc): void {
    // A page deleted while open is stored once more when its editors leave: dropped.
    const id = pageIdOf(name)
    if (!id || !this.workspaceOf(id)) return
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
    const workspace = id ? this.workspaceOf(id) : null
    const page = id ? workspace?.pages.get(id) : null
    if (!id || !workspace || !page) return
    const root = yXmlFragmentToProseMirrorRootNode(
      document.getXmlFragment(PAGE_FIELD),
      documentSchema()
    )
    const content = JSON.stringify(root.toJSON())
    if (content === page.content) return
    const actor = this.lastEditor.get(name) ?? null
    workspace.pages.as(actor, () => workspace.pages.update(id, { content }))
    this.onChange(workspace, id, page.content, actor)
  }

  /**
   * Replaces a page's shared document with `content` (restoring a saved
   * state): every open editor receives the change.
   */
  async replace(instance: Hocuspocus, pageId: string, content: string, user: User): Promise<void> {
    const connection = await instance.openDirectConnection(pageDocumentName(pageId), { user })
    try {
      await connection.transact((document) => {
        const fragment = document.getXmlFragment(PAGE_FIELD)
        fragment.delete(0, fragment.length)
        prosemirrorJSONToYXmlFragment(documentSchema(), JSON.parse(content), fragment)
      })
    } finally {
      await connection.disconnect()
    }
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
      if (!id || this.workspaceOf(id)) continue
      instance.closeConnections(name)
      this.store.prepare('DELETE FROM documents WHERE name = ?').run(name)
    }
  }
}

/** Tells these people's clients that their inbox changed. */
export function announceInbox(instance: Hocuspocus, userIds: string[]): void {
  const wanted = new Set(userIds)
  instance.documents
    .get(WORKSPACE_DOCUMENT)
    ?.broadcastStateless(JSON.stringify({ type: 'inbox' }), (connection) =>
      wanted.has((connection.context as CollabContext | undefined)?.user?.id ?? '')
    )
}

/** Tells every connected client that pages or databases of a workspace changed. */
export function announceChange(instance: Hocuspocus, by: User, workspace: string): void {
  const notice: ChangeNotice = { type: 'changed', by: by.id, workspace }
  instance.documents.get(WORKSPACE_DOCUMENT)?.broadcastStateless(JSON.stringify(notice))
}

/**
 * Checks the session of a WebSocket connection: the token sent by the client,
 * or the web client's session cookie. Readers get a read-only connection.
 */
export function authenticate(
  accounts: Accounts,
  workspaces: Workspaces,
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
    if (id === null) {
      // The workspace channel only carries the server's notices.
      connectionConfig.readOnly = true
      return { user }
    }
    const found = workspaces.findPage(id)
    if (!found || !workspaces.canUse(user, found.id)) throw new Error('Page introuvable.')
    const { pages } = found.workspace
    const level = resolveLevels(pages.list(), pages.allShares(), user).get(id) ?? 'none'
    if (level === 'none') throw new Error('Page introuvable.')
    if (!atLeast(level, 'edit')) connectionConfig.readOnly = true
    return { user }
  }
}
