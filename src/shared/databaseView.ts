import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    databaseView: {
      /** Inserts a block showing the database `databaseId` inside the page */
      insertDatabaseView: (databaseId: string) => ReturnType
      /** Inserts a view of an existing database, with views of its own */
      insertLinkedView: (databaseId: string) => ReturnType
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
      },
      /** Linked view: the block keeps its own views (JSON) instead of the database's */
      views: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-views'),
        renderHTML: (attrs) => (attrs.views ? { 'data-views': attrs.views } : {})
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
          commands.insertContent({ type: this.name, attrs: { databaseId } }),
      insertLinkedView:
        (databaseId) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              databaseId,
              views: JSON.stringify([
                {
                  id: 'linked',
                  name: 'Vue liée',
                  type: 'table',
                  filters: [],
                  filterMode: 'and',
                  sorts: [],
                  hidden: []
                }
              ])
            }
          })
    }
  }
})
