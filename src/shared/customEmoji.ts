import { mergeAttributes, Node } from '@tiptap/core'

/**
 * An emoji of the team in the text: its image, as tall as a letter. Kept by
 * its name and stored src (notionix-asset://…); `display` gives the address
 * the page shows (the web client's /api/assets/…). Written « :nom: » in text
 * and Markdown.
 */
export const CustomEmojiNode = Node.create<{ display: (src: string) => string }>({
  name: 'customEmoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { display: (src: string) => src }
  },
  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-name') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-name': attrs.name })
      },
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-src'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-src': attrs.src })
      }
    }
  },
  parseHTML() {
    return [{ tag: 'img[data-type="custom-emoji"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const name = String(node.attrs.name ?? '')
    const src = typeof node.attrs.src === 'string' ? this.options.display(node.attrs.src) : ''
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'custom-emoji',
        class: 'custom-emoji',
        src,
        alt: `:${name}:`,
        title: `:${name}:`,
        draggable: 'false'
      })
    ]
  },
  renderText({ node }) {
    return `:${String(node.attrs.name ?? '')}:`
  }
})
