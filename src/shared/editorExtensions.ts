import type { AnyExtension, Extensions } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Image } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import type { createLowlight } from 'lowlight'
import { Callout } from './callout'

type Lowlight = ReturnType<typeof createLowlight>

/** Link protocol used for references between pages: notionix://page/<id> */
export const PAGE_LINK_PROTOCOL = 'notionix'
export const pageLinkHref = (id: string): string => `${PAGE_LINK_PROTOCOL}://page/${id}`
export const pageIdFromHref = (href: string): string | null =>
  href.startsWith(`${PAGE_LINK_PROTOCOL}://page/`)
    ? href.slice(`${PAGE_LINK_PROTOCOL}://page/`.length)
    : null

export interface DocumentExtensionOverrides {
  /** Callout with an interactive node view (renderer only) */
  callout?: AnyExtension
}

/**
 * Document schema shared by the editor (renderer) and the importer (main), so
 * imported documents are built against the exact schema the editor loads.
 */
export function createDocumentExtensions(
  lowlight: Lowlight,
  overrides: DocumentExtensionOverrides = {}
): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, protocols: [PAGE_LINK_PROTOCOL] }
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({
      inline: false,
      allowBase64: false,
      resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 48 }
    }),
    TableKit.configure({ table: { resizable: true } }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'toggle' } }),
    DetailsSummary,
    DetailsContent,
    overrides.callout ?? Callout
  ]
}
