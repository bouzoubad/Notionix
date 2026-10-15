import type { AnyExtension, Extensions, Node } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Image, type ImageOptions } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import type { createLowlight } from 'lowlight'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Callout } from './callout'
import { DatabaseView } from './databaseView'

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
  /** Inline database rendered with its views (renderer only) */
  databaseView?: AnyExtension
  /** Opens the equation editor (renderer only) */
  onMathClick?: (node: PmNode, pos: number) => void
  /**
   * Maps a stored image src to the URL the page loads, and back for pasted
   * HTML (web client: notionix-asset://file/<name> is served under /api/assets).
   */
  imageSrc?: { display: (src: string) => string; stored: (url: string) => string }
  /** Real-time collaboration brings its own undo history (renderer only) */
  collaboration?: Extensions
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
      ...(overrides.collaboration ? { undoRedo: false as const } : {}),
      link: { openOnClick: false, autolink: true, protocols: [PAGE_LINK_PROTOCOL] }
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    (overrides.imageSrc ? mappedImage(overrides.imageSrc) : Image).configure({
      inline: false,
      allowBase64: false,
      resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 48 }
    }),
    TableKit.configure({ table: { resizable: true } }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'toggle' } }),
    DetailsSummary,
    DetailsContent,
    // Equations (KaTeX), written $…$ and $$…$$ like Notion's export.
    InlineMath.configure({ katexOptions: { throwOnError: false }, onClick: overrides.onMathClick }),
    BlockMath.configure({
      katexOptions: { throwOnError: false, displayMode: true },
      onClick: overrides.onMathClick
    }),
    overrides.callout ?? Callout,
    overrides.databaseView ?? DatabaseView,
    ...(overrides.collaboration ?? [])
  ]
}

/** Image whose stored src stays canonical while the page shows `display(src)`. */
const mappedImage = ({
  display,
  stored
}: NonNullable<DocumentExtensionOverrides['imageSrc']>): Node<ImageOptions> =>
  Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const src = el.getAttribute('src')
            return src === null ? null : stored(src)
          },
          renderHTML: (attrs: Record<string, unknown>) =>
            typeof attrs.src === 'string' ? { src: display(attrs.src) } : {}
        }
      }
    }
  })
