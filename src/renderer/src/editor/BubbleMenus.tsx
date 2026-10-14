import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'

const SAFE_LINK = /^(https?:|mailto:|tel:|notionix:)/i

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
      shouldShow={({ editor: e, state: s, from, to }) =>
        e.isEditable &&
        from !== to &&
        !(s.selection instanceof NodeSelection) &&
        !e.isActive('codeBlock')
      }
      options={{ placement: 'top' }}
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
          {button('B', 'Gras (⌘B)', state.bold, () => editor.chain().focus().toggleBold().run())}
          {button('I', 'Italique (⌘I)', state.italic, () =>
            editor.chain().focus().toggleItalic().run()
          )}
          {button('U', 'Souligné (⌘U)', state.underline, () =>
            editor.chain().focus().toggleUnderline().run()
          )}
          {button('S', 'Barré', state.strike, () => editor.chain().focus().toggleStrike().run())}
          {button('<>', 'Code', state.code, () => editor.chain().focus().toggleCode().run())}
          {button('Lien', 'Lien', state.link !== null, () => {
            setHref(state.link ?? '')
            setLinking(true)
          })}
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
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('table')}
      options={{ placement: 'top-start' }}
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
