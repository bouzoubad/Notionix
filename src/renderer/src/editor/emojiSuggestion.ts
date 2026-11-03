import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { createMenuController, type SlashItem } from './slashCommands'
import { emojiTone, fold, inTone, loadEmojis, rememberEmoji, searchEmojis } from '../emoji'
import { customEmojis } from '../customEmojis'
import { displaySrc } from '../platform'
import { t } from '../../../shared/i18n'

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
        items: async ({ query }) => {
          const q = fold(query)
          // The team's own first when their name matches.
          const team = (await customEmojis())
            .filter((e) => e.name.includes(q))
            .sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)))
            .slice(0, 4)
            .map((e): SlashItem => ({
              image: displaySrc(e.src),
              title: `:${e.name}:`,
              hint: t('Émoji de l’équipe'),
              keywords: [],
              run: (editor, range) =>
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertContent({ type: 'customEmoji', attrs: { name: e.name, src: e.src } })
                  .run()
            }))
          const tone = emojiTone()
          const standard = searchEmojis(await loadEmojis(), query, 8 - team.length).map(
            (e): SlashItem => {
              const emoji = inTone(e, tone)
              return {
                icon: emoji,
                title: e.label,
                hint: e.shortcodes[0] ? `:${e.shortcodes[0]}:` : '',
                keywords: [],
                run: (editor, range) => {
                  rememberEmoji(emoji)
                  editor.chain().focus().deleteRange(range).insertContent(emoji).run()
                }
              }
            }
          )
          return [...team, ...standard]
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createMenuController
      })
    ]
  }
})
