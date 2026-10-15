import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { atLeast } from '../../../shared/types'
import { useStore } from '../store'

/** Whether this person may comment on the page being edited. */
const canCommentOpenPage = (): boolean => {
  const { pages, currentId } = useStore.getState()
  const page = pages.find((p) => p.id === currentId)
  return !!page && atLeast(page.level, 'comment')
}

/**
 * Opens a discussion on the selection: the text is marked (when the person may
 * edit the page) and quoted in the comments panel.
 */
function startComment(editor: Editor): void {
  const { from, to } = editor.state.selection
  const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 500)
  const threadId = globalThis.crypto.randomUUID()
  const marked = editor.isEditable
  if (marked) editor.chain().focus().setComment(threadId).run()
  useStore.getState().startComment({ threadId, quote, marked })
}

const SAFE_LINK = /^(https?:|mailto:|tel:|notionix:)/i

type ShouldShow = NonNullable<React.ComponentProps<typeof BubbleMenu>['shouldShow']>

// Module-level so they keep the same identity across renders: BubbleMenu hides
// itself whenever these props change, e.g. when an autosave re-renders the page.
// Readers who may comment get the menu too, with the comment button only.
const showTextMenu: ShouldShow = ({ editor, state, from, to }) =>
  (editor.isEditable || canCommentOpenPage()) &&
  from !== to &&
  !(state.selection instanceof NodeSelection) &&
  !editor.isActive('codeBlock')
const showTableMenu: ShouldShow = ({ editor }) => editor.isEditable && editor.isActive('table')
const TEXT_MENU_OPTIONS = { placement: 'top' } as const
const TABLE_MENU_OPTIONS = { placement: 'top-start' } as const

/** Formatting toolbar shown on a text selection, Notion-style. */
export function TextBubbleMenu({ editor }: { editor: Editor }): React.JSX.Element {
  const [linking, setLinking] = useState(false)
  const [href, setHref] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link') ? String(e.getAttributes('link').href ?? '') : null
    })
  })

  const applyLink = (): void => {
    const value = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!value) chain.unsetLink().run()
    else chain.setLink({ href: SAFE_LINK.test(value) ? value : `https://${value}` }).run()
    setLinking(false)
  }

  const button = (
    label: string,
    title: string,
    active: boolean,
    run: () => void
  ): React.JSX.Element => (
    <button
      className={active ? 'active' : ''}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textMenu"
      shouldShow={showTextMenu}
      options={TEXT_MENU_OPTIONS}
      className="bubble"
    >
      {linking ? (
        <span className="bubble-link">
          <input
            autoFocus
            placeholder="Coller un lien…"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink()
              if (e.key === 'Escape') setLinking(false)
            }}
          />
          <button onClick={applyLink}>OK</button>
        </span>
      ) : (
        <>
          {canCommentOpenPage() &&
            button('💬 Commenter', 'Commenter la sélection', false, () => startComment(editor))}
          {editor.isEditable && (
            <>
              {button('B', 'Gras (⌘B)', state.bold, () =>
                editor.chain().focus().toggleBold().run()
              )}
              {button('I', 'Italique (⌘I)', state.italic, () =>
                editor.chain().focus().toggleItalic().run()
              )}
              {button('U', 'Souligné (⌘U)', state.underline, () =>
                editor.chain().focus().toggleUnderline().run()
              )}
              {button('S', 'Barré', state.strike, () =>
                editor.chain().focus().toggleStrike().run()
              )}
              {button('<>', 'Code', state.code, () => editor.chain().focus().toggleCode().run())}
              {button('Lien', 'Lien', state.link !== null, () => {
                setHref(state.link ?? '')
                setLinking(true)
              })}
            </>
          )}
        </>
      )}
    </BubbleMenu>
  )
}

/** Row/column actions shown while the cursor is in a table. */
export function TableBubbleMenu({ editor }: { editor: Editor }): React.JSX.Element {
  const run = (label: string, action: () => boolean): React.JSX.Element => (
    <button onMouseDown={(e) => e.preventDefault()} onClick={action}>
      {label}
    </button>
  )
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      shouldShow={showTableMenu}
      options={TABLE_MENU_OPTIONS}
      className="bubble"
    >
      {run('+ Ligne', () => editor.chain().focus().addRowAfter().run())}
      {run('+ Colonne', () => editor.chain().focus().addColumnAfter().run())}
      {run('− Ligne', () => editor.chain().focus().deleteRow().run())}
      {run('− Colonne', () => editor.chain().focus().deleteColumn().run())}
      {run('En-tête', () => editor.chain().focus().toggleHeaderRow().run())}
      {run('Supprimer le tableau', () => editor.chain().focus().deleteTable().run())}
    </BubbleMenu>
  )
}
