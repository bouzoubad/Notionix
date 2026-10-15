import { Mark, Node, mergeAttributes } from '@tiptap/core'

export type MentionKind = 'user' | 'page' | 'date'

export interface MentionAttrs {
  kind: MentionKind
  /** Account id, page id, or a unique id for a date (its reminder key) */
  id: string
  /** Text when the person or page cannot be shown (export, search) */
  label: string
  /** date: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' */
  date: string | null
  /** date: remind at that time */
  reminder: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mention: {
      insertMention: (
        attrs: Partial<MentionAttrs> & Pick<MentionAttrs, 'kind' | 'id'>
      ) => ReturnType
    }
    comment: {
      /** Marks the selection as discussed in `threadId` */
      setComment: (threadId: string) => ReturnType
      /** Removes the marks of a discussion from the whole document */
      unsetCommentThread: (threadId: string) => ReturnType
    }
  }
}

/** @person, @page or @date inside text: an atom whose label is its text. */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    const attr = (
      name: string,
      fallback: unknown
    ): {
      default: unknown
      parseHTML: (el: HTMLElement) => unknown
      renderHTML: (attrs: Record<string, unknown>) => Record<string, string>
    } => ({
      default: fallback,
      parseHTML: (el: HTMLElement) => {
        const v = el.getAttribute(`data-${name}`)
        if (v === null) return fallback
        return typeof fallback === 'boolean' ? v === 'true' : v
      },
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs[name] === null || attrs[name] === undefined
          ? {}
          : { [`data-${name}`]: String(attrs[name]) }
    })
    return {
      kind: attr('kind', 'user'),
      id: attr('id', ''),
      label: attr('label', ''),
      date: attr('date', null),
      reminder: attr('reminder', false)
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-mention': '',
        class: `mention mention-${node.attrs.kind}`
      }),
      mentionText(node.attrs as MentionAttrs)
    ]
  },

  renderText({ node }) {
    return mentionText(node.attrs as MentionAttrs)
  },

  addCommands() {
    return {
      insertMention:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent([
              { type: this.name, attrs: { label: '', date: null, reminder: false, ...attrs } },
              { type: 'text', text: ' ' }
            ])
            .run()
    }
  }
})

export const mentionText = (a: MentionAttrs): string =>
  a.kind === 'user' ? `@${a.label}` : a.kind === 'date' ? `@${a.label || a.date || ''}` : a.label

/** Text discussed in a comment thread; threads may overlap. */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-thread'),
        renderHTML: (attrs) => (attrs.threadId ? { 'data-thread': attrs.threadId } : {})
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-thread]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]
  },

  addCommands() {
    return {
      setComment:
        (threadId) =>
        ({ commands }) =>
          commands.setMark(this.name, { threadId }),
      unsetCommentThread:
        (threadId) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks[this.name]
          state.doc.descendants((node, pos) => {
            for (const mark of node.marks)
              if (mark.type === type && mark.attrs.threadId === threadId)
                tr.removeMark(pos, pos + node.nodeSize, mark)
          })
          if (dispatch) dispatch(tr)
          return true
        }
    }
  }
})
