import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** Inserts `count` side-by-side columns */
      insertColumns: (count: number) => ReturnType
    }
    blocks: {
      insertTableOfContents: () => ReturnType
      insertPageLink: (pageId: string) => ReturnType
      insertFileBlock: (attrs: { src: string; name: string; size: number }) => ReturnType
      insertMedia: (kind: 'video' | 'audio', src: string) => ReturnType
      insertSyncedBlock: (sourceId: string) => ReturnType
      insertButtonBlock: (attrs?: Partial<ButtonAttrs>) => ReturnType
      /** Turns the toggle at the selection into a heading toggle (0: plain toggle) */
      setToggleHeading: (level: number) => ReturnType
    }
  }
}

interface DataAttr {
  default: unknown
  parseHTML: (el: HTMLElement) => unknown
  renderHTML: (attrs: Record<string, unknown>) => Record<string, string>
}

const dataAttr = (name: string, fallback: unknown = null): DataAttr => ({
  default: fallback,
  parseHTML: (el: HTMLElement): unknown => {
    const v = el.getAttribute(`data-${name}`)
    if (v === null) return fallback
    return typeof fallback === 'number' ? Number(v) || fallback : v
  },
  renderHTML: (attrs: Record<string, unknown>): Record<string, string> =>
    attrs[name] === null || attrs[name] === undefined || attrs[name] === ''
      ? {}
      : { [`data-${name}`]: String(attrs[name]) }
})

/** Side-by-side columns; each column holds blocks. */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,5}',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'columns' }), 0]
  },
  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ state, tr, dispatch }) => {
          const { columns, column, paragraph } = state.schema.nodes
          const node = columns.create(
            null,
            Array.from({ length: Math.min(5, Math.max(2, count)) }, () =>
              column.create(null, paragraph.create())
            )
          )
          if (!dispatch) return true
          const at = tr.selection.from
          tr.replaceSelectionWith(node)
          // Typing continues in the first column.
          const start = tr.mapping.map(at, -1)
          let target = -1
          tr.doc.nodesBetween(
            start,
            Math.min(tr.doc.content.size, start + node.nodeSize + 2),
            (n, p) => {
              if (target < 0 && n.type === paragraph && p >= start) target = p + 1
            }
          )
          if (target >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(target)))
          dispatch(tr.scrollIntoView())
          return true
        }
    }
  }
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'column' }), 0]
  }
})

/** Headings of the page, listed live (renderer view). */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toc' })]
  }
})

/** A block linking to another page, with its live icon and title. */
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { pageId: dataAttr('page-id') }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page-link"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-link' })]
  }
})

/** An attached file (PDF, document, archive…), stored like images. */
export const FileBlock = Node.create({
  name: 'fileBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { src: dataAttr('src'), name: dataAttr('name', 'Fichier'), size: dataAttr('size', 0) }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="file"]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'file' }),
      String(node.attrs.name ?? 'Fichier')
    ]
  }
})

const media = (name: 'video' | 'audio'): Node =>
  Node.create({
    name,
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
      return { src: dataAttr('src') }
    },
    parseHTML() {
      return [{ tag: `div[data-type="${name}"]` }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': name })]
    }
  })

export const Video = media('video')
export const Audio = media('audio')

/**
 * The same content shown in several places: it lives in a hidden page
 * (`sourceId`), and every copy of the block edits that page.
 */
export const SyncedBlock = Node.create({
  name: 'syncedBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { sourceId: dataAttr('source-id') }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="synced"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'synced' })]
  }
})

export interface ButtonAttrs {
  label: string
  /** 'insert': adds the template blocks below; 'addRow': adds a row to a database */
  action: 'insert' | 'addRow'
  /** insert: blocks to add, as a ProseMirror JSON array */
  template: string
  /** addRow: the database */
  databaseId: string | null
}

export const ButtonBlock = Node.create({
  name: 'buttonBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      label: dataAttr('label', 'Nouveau bouton'),
      action: dataAttr('action', 'insert'),
      template: dataAttr('template', '[{"type":"paragraph"}]'),
      databaseId: dataAttr('database-id')
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="button"]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'button' }),
      String(node.attrs.label ?? '')
    ]
  }
})

/** Toggles whose summary looks like a heading (Notion's toggle headings). */
export const ToggleHeadings = Extension.create({
  name: 'toggleHeadings',
  addGlobalAttributes() {
    return [
      {
        types: ['details'],
        attributes: {
          headingLevel: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-heading')) || 0,
            renderHTML: (attrs) =>
              attrs.headingLevel ? { 'data-heading': String(attrs.headingLevel) } : {}
          }
        }
      }
    ]
  }
})

/** Commands inserting the blocks above. */
export const BlockCommands = Extension.create({
  name: 'blocks',
  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'tableOfContents' }),
      insertPageLink:
        (pageId) =>
        ({ commands }) =>
          commands.insertContent({ type: 'pageLink', attrs: { pageId } }),
      insertFileBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: 'fileBlock', attrs }),
      insertMedia:
        (kind, src) =>
        ({ commands }) =>
          commands.insertContent({ type: kind, attrs: { src } }),
      insertSyncedBlock:
        (sourceId) =>
        ({ commands }) =>
          commands.insertContent({ type: 'syncedBlock', attrs: { sourceId } }),
      insertButtonBlock:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: 'buttonBlock', attrs }),
      setToggleHeading:
        (level) =>
        ({ commands }) =>
          commands.updateAttributes('details', { headingLevel: level })
    }
  }
})
