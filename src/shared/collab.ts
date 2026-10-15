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
  /** Workspace whose pages changed */
  workspace: string
}

/** One of the server's workspaces, each with its own pages and files. */
export interface WorkspaceInfo {
  id: string
  name: string
  icon: string | null
  /** Its members; null for the main workspace, open to every account */
  memberIds: string[] | null
  /** Archived: hidden from its members until an administrator restores it */
  archived: boolean
}

/** An entry of the administrators' audit log. */
export interface AuditEntry {
  id: number
  at: number
  actorId: string | null
  action: string
  /** What it was done to: an account, a page, a workspace, a group… */
  target: string | null
  detail: string | null
  workspace: string | null
}

/** The administrators' dashboard. */
export interface AdminOverview {
  users: { total: number; active: number; disabled: number; admins: number; pending: number }
  /** Accounts connected right now (real-time connection open) */
  online: string[]
  sessions: { userId: string; count: number; lastAt: number }[]
  workspaces: {
    id: string
    name: string
    archived: boolean
    pages: number
    databases: number
    trashed: number
    members: number | null
    databaseBytes: number
    files: number
    fileBytes: number
  }[]
  feedbackOpen: number
  /** Server data: databases and files */
  totalBytes: number
}

/** The workspace every account belongs to, holding the pages from before workspaces. */
export const MAIN_WORKSPACE = 'main'
/** Header naming the workspace a request is about (the main one when absent). */
export const WORKSPACE_HEADER = 'X-Notionix-Workspace'

/** Login session as the server returns it. */
export interface SessionUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'reader' | 'guest'
  /** Signed in with a provisional password, to replace first */
  mustChangePassword?: boolean
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
