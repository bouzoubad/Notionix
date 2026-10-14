import type { Editor } from '@tiptap/core'
import { useStore } from '../store'

export const IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/bmp'
]

/** Stores the files locally and inserts them as image blocks, at `pos` or at the selection. */
export async function insertImages(editor: Editor, files: File[], pos?: number): Promise<void> {
  let at = pos
  for (const file of files) {
    try {
      const src = await window.api.assets.save(new Uint8Array(await file.arrayBuffer()), file.name)
      const node = { type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') } }
      if (at === undefined) {
        editor.chain().focus().insertContent(node).run()
      } else {
        editor.chain().insertContentAt(at, node).focus().run()
        at = editor.state.selection.to
      }
    } catch (e) {
      useStore
        .getState()
        .showNotice(
          `Image non ajoutée (${file.name}) : ${e instanceof Error ? e.message : String(e)}`
        )
    }
  }
}

/** Opens the system file picker for images. */
export function pickImages(editor: Editor): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = IMAGE_TYPES.join(',')
  input.multiple = true
  input.onchange = () => {
    if (input.files?.length) void insertImages(editor, [...input.files])
  }
  input.click()
}
