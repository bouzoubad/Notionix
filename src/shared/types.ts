import type { DatabaseRow, DatabaseSchema, PropertyType, PropertyValue } from './database'

export type PageId = string

export interface Page {
  id: PageId
  parentId: PageId | null
  title: string
  icon: string | null
  cover: string | null
  /** TipTap/ProseMirror JSON document, serialised */
  content: string
  position: number
  favorite: boolean
  trashedAt: number | null
  createdAt: number
  updatedAt: number
  /** Monotonic per-row counter, reserved for future sync */
  version: number
  /** A database page shows its rows (child pages) through views */
  kind: PageKind
  /** Database row used as a template for new rows */
  isTemplate: boolean
  /** Account that created the page (null: before accounts existed, or the desktop app) */
  createdBy: string | null
  /** Account that last changed the page */
  updatedBy: string | null
  /** Who sees the page; 'inherit' follows the parent page */
  access: PageAccess
  /** Top-level page shown as a teamspace section in the sidebar */
  isSpace: boolean
  options: PageOptions
  /** Read-only public link token when the page is published on the web */
  publicToken: string | null
  /** What the signed-in person may do with the page (server workspace; 'full' in the desktop app) */
  level: AccessLevel
}

/** 'synced': hidden page holding the content of a synced block */
export type PageKind = 'page' | 'database' | 'synced'

/** 'workspace': every member; 'restricted': its creator and the people it is shared with. */
export type PageAccess = 'inherit' | 'workspace' | 'restricted'

/** Ordered: each level includes the previous ones. 'full' also manages sharing. */
export type AccessLevel = 'none' | 'read' | 'comment' | 'edit' | 'full'
export const ACCESS_LEVELS: AccessLevel[] = ['none', 'read', 'comment', 'edit', 'full']
export const atLeast = (level: AccessLevel, wanted: AccessLevel): boolean =>
  ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(wanted)

export interface PageOptions {
  fullWidth?: boolean
  smallText?: boolean
  font?: 'default' | 'serif' | 'mono'
  /** Locked pages are read-only until unlocked */
  locked?: boolean
}

/** A person of the workspace (server accounts; the desktop app has one local person). */
export interface Person {
  id: string
  name: string
  email: string
  /** Disabled accounts stay listed so their name still shows */
  disabled?: boolean
}

/** A saved state of a page's content, kept to look back or restore. */
export interface PageVersion {
  id: number
  pageId: PageId
  title: string
  createdAt: number
  /** Accounts whose changes the version includes */
  authors: string[]
}

export interface PageVersionContent extends PageVersion {
  content: string
}

export interface Comment {
  id: string
  pageId: PageId
  /** Comments of one discussion share a thread; the first one opens it */
  threadId: string
  authorId: string | null
  body: string
  /** People mentioned in the body (notified) */
  mentions: string[]
  /** Text of the page the discussion is about; null for a comment on the whole page */
  quote: string | null
  createdAt: number
  editedAt: number | null
  resolvedAt: number | null
}

export interface NewComment {
  /** Replies to this thread; a new thread when absent */
  threadId?: string
  body: string
  mentions?: string[]
  quote?: string | null
}

export type InboxKind = 'mention' | 'comment' | 'share' | 'reminder'

export interface InboxItem {
  id: string
  kind: InboxKind
  pageId: PageId | null
  actorId: string | null
  text: string
  /** Thread of a comment notification */
  ref: string | null
  createdAt: number
  readAt: number | null
}

export type ActivityKind = 'created' | 'edited' | 'commented' | 'shared' | 'restored' | 'trashed'

export interface ActivityItem {
  id: number
  pageId: PageId
  actorId: string | null
  kind: ActivityKind
  detail: string | null
  at: number
}

export interface PageShare {
  userId: string
  level: Exclude<AccessLevel, 'none'>
}

export interface DatabaseData {
  id: PageId
  schema: DatabaseSchema
  rows: DatabaseRow[]
}

export interface RowData {
  databaseId: PageId
  schema: DatabaseSchema
  row: DatabaseRow
}

export interface NewRow {
  title?: string
  properties?: Record<string, PropertyValue>
  /** Copies content, icon and values of this template row */
  templateId?: PageId | null
}

export type PageSummary = Omit<Page, 'content'>

export interface PagePatch {
  title?: string
  icon?: string | null
  cover?: string | null
  content?: string
  favorite?: boolean
  options?: PageOptions
}

export interface SearchHit {
  id: PageId
  title: string
  icon: string | null
  snippet: string
}

export interface ImportSummary {
  /** Pages created by this import */
  created: number
  /** Pages already imported earlier (same Notion id), left untouched */
  skipped: number
  /** Page that groups the newly imported top-level pages */
  containerId: PageId | null
  /** Notion databases turned into plain pages (properties and views are not kept) */
  databases: number
  linksResolved: number
  linksUnresolved: number
  /** Images of the export stored locally */
  imagesImported: number
  /** Images not found in the export, unreadable, or remote (kept as a link) */
  imagesMissing: number
  /** Other files of the export (PDFs, unused images…), not imported */
  attachmentsIgnored: number
  warnings: string[]
}

export interface ExportSummary {
  path: string
  pages: number
}

export interface NotionixApi {
  pages: {
    list(): Promise<PageSummary[]>
    get(id: PageId): Promise<Page | null>
    /** `access` sets who sees a new top-level page ('restricted': private) */
    create(parentId: PageId | null, access?: PageAccess, kind?: 'page' | 'synced'): Promise<Page>
    update(id: PageId, patch: PagePatch): Promise<PageSummary>
    move(id: PageId, parentId: PageId | null, index: number): Promise<void>
    trash(id: PageId): Promise<void>
    restore(id: PageId): Promise<void>
    deleteForever(id: PageId): Promise<void>
    duplicate(id: PageId): Promise<Page>
    search(query: string): Promise<SearchHit[]>
    setAccess(id: PageId, access: PageAccess): Promise<PageSummary>
    setSpace(id: PageId, isSpace: boolean): Promise<PageSummary>
    shares(id: PageId): Promise<PageShare[]>
    setShare(id: PageId, userId: string, level: PageShare['level'] | null): Promise<void>
    /** Pages linking to this one */
    backlinks(id: PageId): Promise<PageSummary[]>
    /** Saved states of the page, newest first */
    versions(id: PageId): Promise<PageVersion[]>
    version(versionId: number): Promise<PageVersionContent | null>
    /** Puts back the content of a saved state (itself saved as a new state) */
    restoreVersion(id: PageId, versionId: number): Promise<void>
  }
  people: {
    list(): Promise<Person[]>
  }
  comments: {
    list(pageId: PageId): Promise<Comment[]>
    add(pageId: PageId, input: NewComment): Promise<Comment>
    update(id: string, body: string, mentions: string[]): Promise<Comment>
    remove(id: string): Promise<void>
    resolve(threadId: string, resolved: boolean): Promise<void>
  }
  inbox: {
    list(): Promise<InboxItem[]>
    /** Marks these notifications read; all of them when null */
    markRead(ids: string[] | null): Promise<void>
    /** Latest changes in the pages this person can see */
    activity(): Promise<ActivityItem[]>
    /** Calls `listener` when new notifications arrive; returns how to stop */
    onChange(listener: () => void): () => void
  }
  reminders: {
    /** Sets (or clears with null) the reminder `key` of a page, at a time in ms */
    set(pageId: PageId, key: string, at: number | null, text: string): Promise<void>
  }
  databases: {
    create(parentId: PageId | null): Promise<PageSummary>
    get(id: PageId): Promise<DatabaseData | null>
    getRow(rowId: PageId): Promise<RowData | null>
    updateSchema(id: PageId, schema: DatabaseSchema): Promise<DatabaseSchema>
    createRow(databaseId: PageId, init: NewRow): Promise<DatabaseRow>
    updateRow(rowId: PageId, values: Record<string, PropertyValue>): Promise<DatabaseRow>
    setTemplate(rowId: PageId, isTemplate: boolean): Promise<void>
    changePropertyType(
      databaseId: PageId,
      propertyId: string,
      type: PropertyType
    ): Promise<DatabaseSchema>
  }
  assets: {
    /** Stores an image locally and returns its src (notionix-asset://…) */
    save(bytes: Uint8Array, name: string): Promise<string>
    /** Stores an attached file, video or audio and returns its src */
    saveFile(bytes: Uint8Array, name: string): Promise<string>
    /** Saves a copy of a stored file on this computer, under `fileName` */
    download(src: string, fileName: string): Promise<void>
  }
  transfer: {
    /** Asks for a Notion export (.zip or extracted folder) and imports it; null if cancelled */
    importNotion(): Promise<ImportSummary | null>
    /** Exports a page and its sub-pages, or every page when `pageId` is null; null if cancelled */
    exportMarkdown(pageId: PageId | null): Promise<ExportSummary | null>
  }
}
