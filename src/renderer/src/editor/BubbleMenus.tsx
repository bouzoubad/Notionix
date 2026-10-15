import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { atLeast } from '../../../shared/types'
import { useStore } from '../store'
import { startComment } from './commenting'
import { rememberHighlight } from './shortcuts'
import { backgroundColor, COLOR_LABELS, COLORS, textColor } from '../../../shared/colors'
import { t } from '../../../shared/i18n'

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
  const [coloring, setColoring] = useState(false)
  // Cmd+K on selected text: add or change its link.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.shiftKey) return
      const { from, to } = editor.state.selection
      if (from === to || !editor.isEditable || !editor.isFocused) return
      e.preventDefault()
      setHref(String(editor.getAttributes('link').href ?? ''))
      setLinking(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor])
  const [href, setHref] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link') ? String(e.getAttributes('link').href ?? '') : null,
      // Locking or sharing the page changes which buttons are shown.
      editable: e.isEditable
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
            placeholder={t('Coller un lien…')}
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
            button(t('💬 Commenter'), t('Commenter la sélection'), false, () =>
              startComment(editor)
            )}
          {state.editable && (
            <>
              {button('B', t('Gras (⌘B)'), state.bold, () =>
                editor.chain().focus().toggleBold().run()
              )}
              {button('I', t('Italique (⌘I)'), state.italic, () =>
                editor.chain().focus().toggleItalic().run()
              )}
              {button('U', t('Souligné (⌘U)'), state.underline, () =>
                editor.chain().focus().toggleUnderline().run()
              )}
              {button('S', t('Barré'), state.strike, () =>
                editor.chain().focus().toggleStrike().run()
              )}
              {button('<>', t('Code'), state.code, () => editor.chain().focus().toggleCode().run())}
              {button(t('Lien'), t('Lien'), state.link !== null, () => {
                setHref(state.link ?? '')
                setLinking(true)
              })}
              {button('A▾', t('Couleur'), coloring, () => setColoring(!coloring))}
              {coloring && <ColorPalette editor={editor} onDone={() => setColoring(false)} />}
            </>
          )}
        </>
      )}
    </BubbleMenu>
  )
}

/** Text and background colors of the selection. */
function ColorPalette({
  editor,
  onDone
}: {
  editor: Editor
  onDone: () => void
}): React.JSX.Element {
  const swatch = (
    label: string,
    style: React.CSSProperties,
    run: () => void
  ): React.JSX.Element => (
    <button
      key={label}
      className="swatch"
      title={label}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        run()
        onDone()
      }}
    >
      A
    </button>
  )
  return (
    <div className="color-palette" onMouseDown={(e) => e.preventDefault()}>
      <span className="palette-title">{t('Texte')}</span>
      <div className="palette-row">
        {swatch(t('Par défaut'), {}, () => editor.chain().focus().unsetColor().run())}
        {COLORS.map((c) =>
          swatch(COLOR_LABELS[c], { color: textColor(c) }, () =>
            editor.chain().focus().setColor(textColor(c)).run()
          )
        )}
      </div>
      <span className="palette-title">{t('Fond')}</span>
      <div className="palette-row">
        {swatch(t('Sans fond'), {}, () => editor.chain().focus().unsetBackgroundColor().run())}
        {COLORS.map((c) =>
          swatch(
            t('Fond {color}', { color: COLOR_LABELS[c].toLowerCase() }),
            { background: backgroundColor(c) },
            () => (
              rememberHighlight(backgroundColor(c)),
              editor.chain().focus().setBackgroundColor(backgroundColor(c)).run()
            )
          )
        )}
      </div>
    </div>
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
      {run(t('+ Ligne'), () => editor.chain().focus().addRowAfter().run())}
      {run(t('+ Colonne'), () => editor.chain().focus().addColumnAfter().run())}
      {run(t('− Ligne'), () => editor.chain().focus().deleteRow().run())}
      {run(t('− Colonne'), () => editor.chain().focus().deleteColumn().run())}
      {run(t('En-tête'), () => editor.chain().focus().toggleHeaderRow().run())}
      {run(t('Supprimer le tableau'), () => editor.chain().focus().deleteTable().run())}
    </BubbleMenu>
  )
}
