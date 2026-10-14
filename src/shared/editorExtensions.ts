import type { Extensions } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import type { createLowlight } from 'lowlight'

type Lowlight = ReturnType<typeof createLowlight>

/** Link protocol used for references between pages: notionix://page/<id> */
export const PAGE_LINK_PROTOCOL = 'notionix'
export const pageLinkHref = (id: string): string => `${PAGE_LINK_PROTOCOL}://page/${id}`
export const pageIdFromHref = (href: string): string | null =>
  href.startsWith(`${PAGE_LINK_PROTOCOL}://page/`)
    ? href.slice(`${PAGE_LINK_PROTOCOL}://page/`.length)
    : null

/**
 * Document schema shared by the editor (renderer) and the importer (main), so
 * imported documents are built against the exact schema the editor loads.
 */
export function createDocumentExtensions(lowlight: Lowlight): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, protocols: [PAGE_LINK_PROTOCOL] }
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true })
  ]
}
