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
}

export type PageKind = 'page' | 'database'

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
    create(parentId: PageId | null): Promise<Page>
    update(id: PageId, patch: PagePatch): Promise<PageSummary>
    move(id: PageId, parentId: PageId | null, index: number): Promise<void>
    trash(id: PageId): Promise<void>
    restore(id: PageId): Promise<void>
    deleteForever(id: PageId): Promise<void>
    duplicate(id: PageId): Promise<Page>
    search(query: string): Promise<SearchHit[]>
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
  }
  transfer: {
    /** Asks for a Notion export (.zip or extracted folder) and imports it; null if cancelled */
    importNotion(): Promise<ImportSummary | null>
    /** Exports a page and its sub-pages, or every page when `pageId` is null; null if cancelled */
    exportMarkdown(pageId: PageId | null): Promise<ExportSummary | null>
  }
}
