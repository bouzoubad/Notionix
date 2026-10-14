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
}
