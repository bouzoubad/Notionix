import type { ComponentType } from 'react'
import type { Extensions } from '@tiptap/core'
import type { SessionUser, WorkspaceInfo } from '../../shared/collab'
import { atLeast, type PageSummary } from '../../shared/types'

/** A page opened for editing together: its editor extensions, and how to close it. */
export interface SharedPage {
  extensions: Extensions
  /** Resolves once the page's content has arrived from the server */
  ready: Promise<void>
  destroy: () => void
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
    switchTo: (id: string) => void
  }
}

/**
 * Where the app runs. The desktop app keeps pages on this computer; the web
 * client edits the workspace of a Notionix server with other people.
 */
export interface Platform {
  kind: 'desktop' | 'web'
  session: ServerSession | null
  /** Maps a stored image src to the URL the page loads, and back */
  imageSrc?: { display: (src: string) => string; stored: (url: string) => string }
}

let current: Platform = { kind: 'desktop', session: null }

export const platform = (): Platform => current

/** Set once by the web entry point, before the app is loaded. */
export function setPlatform(next: Platform): void {
  current = next
}

export const displaySrc = (src: string): string => current.imageSrc?.display(src) ?? src

/** Whether this person may change the page: their level on it, and the page not locked. */
export const canEditPage = (page: Pick<PageSummary, 'level' | 'options'>): boolean =>
  atLeast(page.level, 'edit') && !page.options.locked
