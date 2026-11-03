import type { Editor } from '@tiptap/core'
import { t } from '../../../shared/i18n'

/** A kind of block a block can become; the text is kept. */
export interface TurnTarget {
  name: string
  label: string
  run: (editor: Editor) => void
}

/** What a block can become; the text is kept. */
export const TURN_TARGETS: TurnTarget[] = [
  { name: 'paragraph', label: t('Texte'), run: (e) => e.chain().clearNodes().setParagraph().run() },
  {
    name: 'h1',
    label: t('Titre 1'),
    run: (e) => e.chain().clearNodes().setHeading({ level: 1 }).run()
  },
  {
    name: 'h2',
    label: t('Titre 2'),
    run: (e) => e.chain().clearNodes().setHeading({ level: 2 }).run()
  },
  {
    name: 'h3',
    label: t('Titre 3'),
    run: (e) => e.chain().clearNodes().setHeading({ level: 3 }).run()
  },
  {
    name: 'bullet',
    label: t('Liste à puces'),
    run: (e) => e.chain().clearNodes().toggleBulletList().run()
  },
  {
    name: 'ordered',
    label: t('Liste numérotée'),
    run: (e) => e.chain().clearNodes().toggleOrderedList().run()
  },
  {
    name: 'task',
    label: t('Liste de tâches'),
    run: (e) => e.chain().clearNodes().toggleTaskList().run()
  },
  { name: 'toggle', label: t('Toggle'), run: (e) => e.chain().clearNodes().setDetails().run() },
  ...[1, 2, 3].map((level) => ({
    name: `toggle-h${level}`,
    label: t('Titre {level} repliable', { level }),
    run: (e: Editor) => e.chain().clearNodes().setDetails().setToggleHeading(level).run()
  })),
  {
    name: 'quote',
    label: t('Citation'),
    run: (e) => e.chain().clearNodes().toggleBlockquote().run()
  },
  { name: 'callout', label: t('Callout'), run: (e) => e.chain().clearNodes().setCallout().run() },
  { name: 'code', label: t('Code'), run: (e) => e.chain().clearNodes().setCodeBlock().run() }
]

// An equation: the text of the block becomes its LaTeX.
TURN_TARGETS.push({ name: 'equation', label: t('Équation'), run: () => undefined })

/** The block holding the selection (its innermost line), and what kind it is. */
export function selectionBlock(editor: Editor): { pos: number; kind: string } | null {
  const { $from } = editor.state.selection
  let depth = $from.depth
  while (depth > 0 && !$from.node(depth).isTextblock) depth--
  if (depth === 0) return null
  const node = $from.node(depth)
  const parent = depth > 1 ? $from.node(depth - 1) : null
  const grand = depth > 2 ? $from.node(depth - 2) : null
  let kind = 'paragraph'
  if (node.type.name === 'heading') kind = `h${node.attrs.level as number}`
  else if (node.type.name === 'codeBlock') kind = 'code'
  else if (node.type.name === 'detailsSummary') kind = 'toggle'
  else if (parent?.type.name === 'taskItem') kind = 'task'
  else if (parent?.type.name === 'listItem')
    kind = grand?.type.name === 'orderedList' ? 'ordered' : 'bullet'
  else if (parent?.type.name === 'blockquote') kind = 'quote'
  else if (parent?.type.name === 'callout') kind = 'callout'
  return { pos: $from.before(depth), kind }
}

/** The selected text becomes an equation in the line (its LaTeX). */
export function selectionToInlineEquation(editor: Editor): void {
  const { from, to } = editor.state.selection
  const latex = editor.state.doc.textBetween(from, to, ' ')
  if (!latex.trim()) return
  editor
    .chain()
    .focus()
    .insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex } })
    .run()
}

/**
 * Turns the block at `pos` into `target`, its text kept: a line becoming a
 * toggle is the toggle's title (as in Notion), an equation takes the text
 * as its LaTeX.
 */
export function turnBlockInto(editor: Editor, pos: number, target: TurnTarget): void {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  if (target.name === 'equation') {
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: pos, to: pos + node.nodeSize },
        { type: 'blockMath', attrs: { latex: node.textContent } }
      )
      .run()
    return
  }
  const level =
    target.name === 'toggle' ? 0 : Number(target.name.match(/^toggle-h(\d)$/)?.[1] ?? -1)
  if (level >= 0 && node.isTextblock) {
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: pos, to: pos + node.nodeSize },
        {
          type: 'details',
          attrs: { headingLevel: level },
          content: [
            { type: 'detailsSummary', content: node.content.toJSON() ?? [] },
            { type: 'detailsContent', content: [{ type: 'paragraph' }] }
          ]
        }
      )
      .run()
    return
  }
  // The cursor in the block, so the text commands apply to it.
  const from = Math.min(pos + 1, editor.state.doc.content.size)
  const to = Math.max(from, pos + node.nodeSize - 1)
  editor.chain().focus().setTextSelection({ from, to }).run()
  target.run(editor)
  // The caret at the end of the block: the text is no longer selected, so the next key does not replace it.
  editor.commands.setTextSelection(editor.state.selection.to)
}
