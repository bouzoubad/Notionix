import { Extension, InputRule, wrappingInputRule } from '@tiptap/core'
import { Blockquote } from '@tiptap/extension-blockquote'

/**
 * Notion's Markdown shortcuts where they differ from the editor's defaults:
 * '"' + space makes a quote (">" makes a toggle, below).
 */
export const NotionBlockquote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["“«]\s$/, type: this.type })]
  }
})

/** '>' + space makes a toggle, '[]' + space a to-do item. */
export const NotionInputRules = Extension.create({
  name: 'notionInputRules',
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*>\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setDetails().run()
        }
      }),
      new InputRule({
        find: /^\s*\[\]\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).toggleTaskList().run()
        }
      })
    ]
  }
})
