import { Extension, type Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { useStore } from '../store'
import { startComment } from './commenting'

/** The top-level block holding the selection, with its position. */
function currentBlock(editor: Editor): { pos: number; size: number } | null {
  const { $from } = editor.state.selection
  if ($from.depth === 0) {
    const sel = editor.state.selection
    return sel instanceof NodeSelection ? { pos: sel.from, size: sel.node.nodeSize } : null
  }
  const pos = $from.before(1)
  const node = editor.state.doc.nodeAt(pos)
  return node ? { pos, size: node.nodeSize } : null
}

/** Turns the block at the cursor into another type (Notion's Cmd+Alt+0…9). */
function turnInto(editor: Editor, kind: number): boolean {
  const chain = editor.chain().focus()
  switch (kind) {
    case 0:
      return chain.clearNodes().setParagraph().run()
    case 1:
    case 2:
    case 3:
      return chain
        .clearNodes()
        .setHeading({ level: kind as 1 | 2 | 3 })
        .run()
    case 4:
      return chain.clearNodes().toggleTaskList().run()
    case 5:
      return chain.clearNodes().toggleBulletList().run()
    case 6:
      return chain.clearNodes().toggleOrderedList().run()
    case 7:
      return chain.clearNodes().setDetails().run()
    case 8:
      return chain.clearNodes().setCodeBlock().run()
    case 9: {
      // A new sub-page, linked here.
      const { currentId, load, open } = useStore.getState()
      void window.api.pages.create(currentId).then(async (page) => {
        editor.chain().focus().insertPageLink(page.id).run()
        await load()
        open(page.id)
      })
      return true
    }
    default:
      return false
  }
}

/** Moves the block at the cursor up or down by one block. */
function moveBlock(editor: Editor, direction: -1 | 1): boolean {
  const block = currentBlock(editor)
  if (!block) return false
  const { state } = editor
  const $pos = state.doc.resolve(block.pos)
  const index = $pos.index(0)
  const target = index + direction
  if (target < 0 || target >= state.doc.childCount) return true
  const node = state.doc.child(index)
  const other = state.doc.child(target)
  const offset = state.selection.from - block.pos
  const tr = state.tr
  if (direction === -1) {
    const otherPos = block.pos - other.nodeSize
    tr.delete(block.pos, block.pos + node.nodeSize).insert(otherPos, node)
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(otherPos + offset, tr.doc.content.size)))
    )
  } else {
    const after = block.pos + node.nodeSize + other.nodeSize
    tr.insert(after, node).delete(block.pos, block.pos + node.nodeSize)
    const newPos = block.pos + other.nodeSize
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(newPos + offset, tr.doc.content.size)))
    )
  }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

let lastHighlight = 'var(--nx-yellow-bg)'
/** The background color last used, applied again by Cmd+Shift+H. */
export const rememberHighlight = (color: string): void => {
  lastHighlight = color
}

/**
 * Notion's editing shortcuts: turn into (Cmd+Alt+0…9), duplicate (Cmd+D),
 * move (Cmd+Shift+↑/↓), check or open (Cmd+Enter), highlight (Cmd+Shift+H),
 * all toggles (Cmd+Alt+T), comment (Cmd+Shift+M), select the block (Esc).
 */
export const NotionShortcuts = Extension.create({
  name: 'notionShortcuts',
  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {
      'Mod-d': () => {
        const block = currentBlock(this.editor)
        if (!block) return false
        const node = this.editor.state.doc.nodeAt(block.pos)!
        return this.editor
          .chain()
          .insertContentAt(block.pos + block.size, node.toJSON())
          .run()
      },
      'Mod-Shift-ArrowUp': () => moveBlock(this.editor, -1),
      'Mod-Shift-ArrowDown': () => moveBlock(this.editor, 1),
      'Mod-Enter': () => {
        const e = this.editor
        if (e.isActive('taskItem')) {
          const checked = e.getAttributes('taskItem').checked === true
          return e.chain().updateAttributes('taskItem', { checked: !checked }).run()
        }
        if (e.isActive('details')) {
          const open = e.getAttributes('details').open === true
          return e.chain().updateAttributes('details', { open: !open }).run()
        }
        return false
      },
      'Mod-Shift-h': () => this.editor.chain().focus().setBackgroundColor(lastHighlight).run(),
      'Mod-Alt-t': () => {
        const { state } = this.editor
        const toggles: number[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'details') toggles.push(pos)
        })
        if (!toggles.length) return false
        const anyClosed = toggles.some((pos) => state.doc.nodeAt(pos)?.attrs.open !== true)
        const tr = state.tr
        for (const pos of toggles) tr.setNodeAttribute(pos, 'open', anyClosed)
        this.editor.view.dispatch(tr)
        return true
      },
      'Mod-Shift-m': () => {
        startComment(this.editor)
        return true
      },
      Escape: () => {
        // A first Escape selects the block (then the block handle's actions apply).
        const block = currentBlock(this.editor)
        if (!block || this.editor.state.selection instanceof NodeSelection) return false
        this.editor.view.dispatch(
          this.editor.state.tr.setSelection(NodeSelection.create(this.editor.state.doc, block.pos))
        )
        return true
      }
    }
    for (let n = 0; n <= 9; n += 1) shortcuts[`Mod-Alt-${n}`] = () => turnInto(this.editor, n)
    return shortcuts
  }
})
