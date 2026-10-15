import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Notion-style handle shown left of the hovered top-level block: drag it to
 * move the block, click it to select the block.
 */
export const BlockHandle = Extension.create({
  name: 'blockHandle',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockHandle'),
        view: (view) => new HandleView(view)
      })
    ]
  }
})

/** Asks the page to open the menu of the block at `pos`. */
export interface BlockMenuRequest {
  pos: number
  left: number
  top: number
}

/** Width of the margin left of the blocks where the handle lives. */
const GUTTER = 48

class HandleView {
  private readonly handle: HTMLElement
  private blockPos: number | null = null

  constructor(private readonly view: EditorView) {
    this.handle = document.createElement('div')
    this.handle.className = 'block-handle'
    this.handle.draggable = true
    this.handle.title = 'Glisser pour déplacer, cliquer pour le menu du bloc'
    this.handle.textContent = '⋮⋮'
    this.handle.addEventListener('dragstart', this.onDragStart)
    // Selecting on mousedown would cancel the native drag, so it happens on click.
    this.handle.addEventListener('click', this.onClick)
    view.dom.addEventListener('mousemove', this.onMove)
    document.addEventListener('mousemove', this.onDocumentMove)
  }

  private onMove = (event: MouseEvent): void => {
    // Keep the handle still while a button is held: moving it would cancel a
    // drag being started from it, and it must not jump during text selection.
    if (!this.view.editable || event.buttons !== 0) return
    // The editor element can be moved after creation (React mounts it), so the
    // handle follows its current parent.
    const parentEl = this.view.dom.parentElement
    if (!parentEl) return
    if (this.handle.parentElement !== parentEl) parentEl.appendChild(this.handle)
    const box = this.view.dom.getBoundingClientRect()
    const hit = this.view.posAtCoords({ left: box.left + GUTTER, top: event.clientY })
    if (!hit) return
    const $pos = this.view.state.doc.resolve(hit.pos)
    const start = $pos.depth >= 1 ? $pos.before(1) : hit.pos
    const dom = this.view.nodeDOM(start)
    if (!(dom instanceof HTMLElement)) return
    this.blockPos = start
    const parent = parentEl.getBoundingClientRect()
    const rect = dom.getBoundingClientRect()
    const lineHeight = parseFloat(getComputedStyle(dom).lineHeight) || 24
    this.handle.style.top = `${rect.top - parent.top + Math.min(lineHeight, rect.height) / 2 - 11}px`
    this.handle.style.left = `${rect.left - parent.left - 26}px`
    this.handle.classList.add('visible')
  }

  /** Hides the handle once the pointer leaves the blocks and their left margin. */
  private onDocumentMove = (event: MouseEvent): void => {
    if (!this.handle.classList.contains('visible')) return
    const box = this.view.dom.getBoundingClientRect()
    const inside =
      event.clientX >= box.left - GUTTER &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    if (!inside) this.handle.classList.remove('visible')
  }

  private select(): NodeSelection | null {
    if (this.blockPos === null || this.blockPos > this.view.state.doc.content.size) return null
    const selection = NodeSelection.create(this.view.state.doc, this.blockPos)
    this.view.dispatch(this.view.state.tr.setSelection(selection))
    return selection
  }

  /** A click selects the block and opens its menu (transform, color, duplicate…). */
  private onClick = (): void => {
    const selection = this.select()
    this.view.focus()
    if (!selection) return
    const rect = this.handle.getBoundingClientRect()
    window.dispatchEvent(
      new CustomEvent<BlockMenuRequest>('notionix:block-menu', {
        detail: { pos: selection.from, left: rect.left, top: rect.bottom + 4 }
      })
    )
  }

  private onDragStart = (event: DragEvent): void => {
    const selection = this.select()
    if (!selection || !event.dataTransfer) return
    const dom = this.view.nodeDOM(selection.from)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', selection.node.textContent)
    if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0)
    // ProseMirror moves the dragged slice on drop when `view.dragging` is set.
    ;(this.view as unknown as { dragging: unknown }).dragging = {
      slice: selection.content(),
      move: true,
      node: selection
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener('mousemove', this.onMove)
    document.removeEventListener('mousemove', this.onDocumentMove)
    this.handle.remove()
  }
}
