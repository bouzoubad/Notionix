import type { Appearance } from '../../shared/appearance'
import type { ComponentType } from 'react'
import type { Extensions } from '@tiptap/core'
import type { CustomEmoji, PagesElsewhere, SessionUser, WorkspaceInfo } from '../../shared/collab'
import { atLeast, type PageSummary } from '../../shared/types'

/** A page opened for editing together: its editor extensions, and how to close it. */
export interface SharedPage {
  extensions: Extensions
  /** Resolves once the page's content has arrived from the server */
  ready: Promise<void>
  /**
   * Resolves once the server's version has arrived and is stored on this
   * device (when it keeps documents); rejects when the server is out of reach
   */
  stored?: Promise<void>
  destroy: () => void
}

/** Where keeping the team's pages on this device stands (desktop app linked to a server). */
export interface OfflineStatus {
  /** Keeping pages up to date now */
  running: boolean
  /** Pages kept in this pass, out of `total` */
  done: number
  total: number
  /** End of the last complete pass; null when never */
  at: number | null
}

/** Where a page's choice comes from: its own, a parent's, its workspace's, or always kept. */
export type OfflineSource = 'page' | 'parent' | 'workspace' | 'always'

/**
 * The copies of the team's pages kept on this device for working without
 * network, chosen per workspace and per page (like OneDrive's "always keep
 * on this device" and "online only").
 */
export interface OfflineCopies {
  /** A new value after every change, told to `subscribe` */
  status: () => OfflineStatus
  subscribe: (listener: () => void) => () => void
  /** Whether a page of the open workspace is kept here, why, and what it would be without its own choice */
  availability: (pageId: string) => {
    value: 'keep' | 'online'
    source: OfflineSource
    inherited: 'keep' | 'online'
  }
  /** A page's own choice, for it and its sub-pages (null: as its parent or workspace) */
  setPage: (pageId: string, value: 'keep' | 'online' | null) => void
  /** When the page was last kept here; null when never */
  keptAt: (pageId: string) => number | null
  /** The choices per workspace, and how much room the copies take */
  Dialog: ComponentType<{ onClose: () => void; connected: boolean }>
}

/** Someone connected to the workspace, and the page they have open. */
export interface Presence {
  clientId: number
  userId: string
  name: string
  color: string
  pageId: string | null
}

/** The connection to a Notionix server (web client). */
export interface ServerSession {
  /** Tells the others which page this person has open */
  setPage: (pageId: string | null) => void
  /** People connected (this person excluded); called on every change */
  onPresence: (listener: (people: Presence[]) => void) => () => void
  /** Whether the real-time connection is up; called on every change */
  onStatus: (listener: (connected: boolean) => void) => () => void
  user: SessionUser
  /** Joins the shared document of a page */
  openPage: (pageId: string) => SharedPage
  logout: () => Promise<void>
  /** Account settings (own password; team accounts for administrators) */
  Settings: ComponentType<{ onClose: () => void }>
  /** Bugs and ideas sent to the administrators; `focus` shows one first */
  Feedback: ComponentType<{ onClose: () => void; focus: string | null }>
  /** The workspaces this person can open, and the one open now */
  workspaces: {
    current: string
    list: () => Promise<WorkspaceInfo[]>
    /** Opens the workspace, on one of its pages when given */
    switchTo: (id: string, pageId?: string | null) => void
    /** The pages of another workspace this person can open (shown in the sidebar) */
    pagesOf: (id: string) => Promise<PageSummary[]>
    /** This person's favorites and private pages in the other workspaces */
    elsewhere: () => Promise<PagesElsewhere[]>
    /** The workspace holding a page this person can open; null when there is none */
    locate: (pageId: string) => Promise<string | null>
  }
}

/**
 * Where the app runs. The desktop app keeps pages on this computer; the web
 * client edits the workspace of a Notionix server with other people. The
 * desktop app linked to a server does both: private pages on this computer,
 * the team's on the server.
 */
export interface Platform {
  kind: 'desktop' | 'web'
  session: ServerSession | null
  /** Maps a stored image src to the URL the page loads, and back */
  imageSrc?: { display: (src: string) => string; stored: (url: string) => string }
  /** The server's address for links given to others (the page's own origin by default) */
  origin?: string
  /** Desktop app linked to a server: whether a page is kept on this computer only */
  isLocal?: (pageId: string) => boolean
  /** Desktop app: links it to a server, or signs in again when the session has ended */
  ServerConnect?: ComponentType<{ onClose: () => void }>
  /** Desktop app: the link to the server needs the password again */
  signInAgain?: boolean
  /** Desktop app linked to a server: the copies of the team's pages kept on this computer */
  offline?: OfflineCopies
  /** Notices of the platform shown with the release notes (desktop app: a new version) */
  Notices?: ComponentType
  /** The team's own emojis (server); absent: none (desktop app on its own) */
  emojis?: {
    list: () => Promise<CustomEmoji[]>
    add: (name: string, image: File) => Promise<CustomEmoji>
    remove: (name: string) => Promise<void>
  }
  /** The person's colours (Apparence) kept in their account; absent: on this device only */
  appearance?: {
    load: () => Promise<Appearance | null>
    save: (appearance: Appearance) => Promise<void>
  }
}

let current: Platform = { kind: 'desktop', session: null }

export const platform = (): Platform => current

/** The server session for a page: none for the pages kept on this computer. */
export const sessionFor = (pageId: string | null): ServerSession | null =>
  pageId && current.isLocal?.(pageId) ? null : current.session

/** Whether a page is kept on this computer only (desktop app linked to a server). */
export const isLocalPage = (pageId: string | null): boolean =>
  pageId !== null && current.isLocal?.(pageId) === true

/**
 * Whether a page may name another (link, mention, linked database). A team
 * page never names a private page kept on this computer: its title would
 * reach the server. `sameSide`: both pages on the same side (relations,
 * database views read from one place).
 */
export function canReference(from: string | null, to: string, sameSide = false): boolean {
  if (!current.isLocal) return true
  const fromLocal = isLocalPage(from)
  const toLocal = isLocalPage(to)
  return sameSide ? fromLocal === toLocal : fromLocal || !toLocal
}

/** Address of the server, for links to give to other people. */
export const serverOrigin = (): string => current.origin ?? location.origin

/** Set once by the entry point (web or desktop), before the app is loaded. */
export function setPlatform(next: Platform): void {
  current = next
}

export const displaySrc = (src: string): string => current.imageSrc?.display(src) ?? src

/** Whether this person may change the page: their level on it, and the page not locked. */
export const canEditPage = (page: Pick<PageSummary, 'level' | 'options'>): boolean =>
  atLeast(page.level, 'edit') && !page.options.locked
