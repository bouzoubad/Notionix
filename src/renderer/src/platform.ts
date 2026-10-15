import type { ComponentType } from 'react'
import type { Extensions } from '@tiptap/core'
import type { SessionUser } from '../../shared/collab'

/** A page opened for editing together: its editor extensions, and how to close it. */
export interface SharedPage {
  extensions: Extensions
  /** Resolves once the page's content has arrived from the server */
  ready: Promise<void>
  destroy: () => void
}

/** The connection to a Notionix server (web client). */
export interface ServerSession {
  user: SessionUser
  /** Joins the shared document of a page */
  openPage: (pageId: string) => SharedPage
  logout: () => Promise<void>
  /** Account settings (own password; team accounts for administrators) */
  Settings: ComponentType<{ onClose: () => void }>
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

/** Readers of a server workspace see pages without changing them. */
export const canEdit = (): boolean => current.session?.user.role !== 'reader'
