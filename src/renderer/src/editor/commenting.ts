import type { Editor } from '@tiptap/core'
import { randomId } from '../../../shared/database'
import { useStore } from '../store'

/**
 * Opens a discussion on the selection: the text is marked (when the person may
 * edit the page) and quoted in the comments panel.
 */
export function startComment(editor: Editor): void {
  const { from, to } = editor.state.selection
  if (from === to) return
  const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 500)
  const threadId = randomId(24)
  const marked = editor.isEditable
  if (marked) editor.chain().focus().setComment(threadId).run()
  useStore.getState().startComment({ threadId, quote, marked })
}
