import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { createMenuController, type SlashItem } from './slashCommands'
import { loadEmojis, rememberEmoji, searchEmojis } from '../emoji'

/** What may follow ":" to look for an emoji: a word, two letters at least. */
const QUERY = /^[\p{L}\p{N}_+-]{2,30}$/u

/**
 * ":" then a name (":coeur", ":rocket", ":thumbsup") offers emojis, like in
 * Notion or Slack; Enter or a click inserts one. A colon after a word or a
 * number (times, links, « Note : ») stays text.
 */
export const EmojiSuggestion = Extension.create({
  name: 'emojiSuggestion',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('emojiSuggestion'),
        char: ':',
        allowSpaces: false,
        allow: ({ state, range }) =>
          QUERY.test(state.doc.textBetween(Math.min(range.from + 1, range.to), range.to)),
        items: async ({ query }) =>
          searchEmojis(await loadEmojis(), query, 8).map((e) => ({
            icon: e.emoji,
            title: e.label,
            hint: e.shortcodes[0] ? `:${e.shortcodes[0]}:` : '',
            keywords: [],
            run: (editor, range) => {
              rememberEmoji(e.emoji)
              editor.chain().focus().deleteRange(range).insertContent(e.emoji).run()
            }
          })),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createMenuController
      })
    ]
  }
})
