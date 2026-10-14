import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    databaseView: {
      /** Inserts a block showing the database `databaseId` inside the page */
      insertDatabaseView: (databaseId: string) => ReturnType
    }
  }
}

/**
 * A database shown inside a page (Notion's inline database). The block only
 * references the database page; deleting the block keeps the database.
 */
export const DatabaseView = Node.create({
  name: 'databaseView',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-database-id'),
        renderHTML: (attrs) => ({ 'data-database-id': attrs.databaseId })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database-view"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database-view' })]
  },

  addCommands() {
    return {
      insertDatabaseView:
        (databaseId) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { databaseId } })
    }
  }
})
