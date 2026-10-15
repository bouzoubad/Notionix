/**
 * Names shared by the collaboration server and the web client: one Yjs
 * document per page, plus the workspace channel announcing changes to pages
 * and databases.
 */
export const WORKSPACE_DOCUMENT = 'workspace:main'

/** Field holding the page in its Yjs document (TipTap's Collaboration default). */
export const PAGE_FIELD = 'default'

const PAGE_DOCUMENT = /^page:([A-Za-z0-9_-]{1,64})$/

export const pageDocumentName = (id: string): string => `page:${id}`

export const pageIdOf = (documentName: string): string | null =>
  PAGE_DOCUMENT.exec(documentName)?.[1] ?? null

/** Stateless message sent on the workspace channel. */
export interface ChangeNotice {
  type: 'changed'
  /** Account that made the change */
  by: string
}

/** Login session as the server returns it. */
export interface SessionUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'reader' | 'guest'
}

export type FeedbackKind = 'bug' | 'idea'
export type FeedbackStatus = 'new' | 'planned' | 'in_progress' | 'done' | 'declined'

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Nouveau',
  planned: 'Prévu',
  in_progress: 'En cours',
  done: 'Fait',
  declined: 'Non retenu'
}

/** A bug report or an idea sent from the app to the administrators. */
export interface Feedback {
  id: string
  userId: string | null
  userName: string
  kind: FeedbackKind
  title: string
  body: string
  /** Stored image (notionix-asset://…) */
  screenshot: string | null
  /** Where it was sent from: page, browser, version */
  context: Record<string, string>
  status: FeedbackStatus
  /** The administrators' answer, shown to the sender */
  reply: string | null
  createdAt: number
  updatedAt: number
}
