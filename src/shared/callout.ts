import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the selected blocks in a callout */
      setCallout: (icon?: string) => ReturnType
    }
  }
}

export const DEFAULT_CALLOUT_ICON = '💡'

/** Highlighted block with an emoji icon, like Notion's callout. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      icon: {
        default: DEFAULT_CALLOUT_ICON,
        parseHTML: (el) => el.getAttribute('data-icon') || DEFAULT_CALLOUT_ICON,
        renderHTML: (attrs) => ({ 'data-icon': attrs.icon })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },

  addCommands() {
    return {
      setCallout:
        (icon = DEFAULT_CALLOUT_ICON) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { icon })
    }
  }
})
