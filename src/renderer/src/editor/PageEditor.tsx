import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { common, createLowlight } from 'lowlight'
import type { Page } from '../../../shared/types'
import { createDocumentExtensions, pageIdFromHref } from '../../../shared/editorExtensions'
import { ancestorsOf, useStore } from '../store'
import { SlashCommands } from './slashCommands'
import { FileHandler } from '@tiptap/extension-file-handler'
import { InteractiveCallout } from './CalloutView'
import { BlockHandle } from './blockHandle'
import { TableBubbleMenu, TextBubbleMenu } from './BubbleMenus'
import { IMAGE_TYPES, insertImages } from './images'
import { PageDecorations } from '../components/PageDecorations'
import { RowProperties } from '../database/RowProperties'
import { InteractiveDatabaseView } from '../database/InlineDatabase'

const lowlight = createLowlight(common)
const SAVE_DELAY_MS = 400

export function PageEditor({ pageId }: { pageId: string }): React.JSX.Element | null {
  const [loaded, setLoaded] = useState<{ id: string; page: Page | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.pages.get(pageId).then((page) => {
      if (!cancelled) setLoaded({ id: pageId, page })
    })
    return () => {
      cancelled = true
    }
  }, [pageId])
  const page = loaded?.id === pageId ? loaded.page : null
  if (!page) return null
  return <LoadedEditor key={page.id} page={page} />
}

function LoadedEditor({ page }: { page: Page }): React.JSX.Element {
  const patch = useStore((s) => s.patch)
  const pages = useStore((s) => s.pages)
  const open = useStore((s) => s.open)
  const summary = pages.find((p) => p.id === page.id)
  const [title, setTitle] = useState(page.title)
  const isRow = pages.some((p) => p.id === page.parentId && p.kind === 'database')
  const pending = useRef<{ content?: string; title?: string }>({})
  const timer = useRef<number | undefined>(undefined)

  const flush = (): void => {
    window.clearTimeout(timer.current)
    const p = pending.current
    pending.current = {}
    if (p.content !== undefined || p.title !== undefined) void patch(page.id, p)
  }
  const schedule = (part: { content?: string; title?: string }): void => {
    pending.current = { ...pending.current, ...part }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
  }
  useEffect(() => flush, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Opens the equation dialog for the equation at `pos`, or for a new one when `pos` is null. */
  const editMath = (inline: boolean, latex: string, pos: number | null): void => {
    useStore.getState().setMathEdit({
      latex,
      inline,
      apply: (next) => {
        // `editor` is read when the dialog is validated, long after this render.
        if (!editor) return
        const chain = editor.chain().focus()
        if (pos === null) {
          if (next)
            (inline
              ? chain.insertInlineMath({ latex: next })
              : chain.insertBlockMath({ latex: next })
            ).run()
          return
        }
        if (!next) (inline ? chain.deleteInlineMath({ pos }) : chain.deleteBlockMath({ pos })).run()
        else
          (inline
            ? chain.updateInlineMath({ latex: next, pos })
            : chain.updateBlockMath({ latex: next, pos })
          ).run()
      }
    })
  }
  const editor = useEditor({
    extensions: [
      ...createDocumentExtensions(lowlight, {
        callout: InteractiveCallout,
        databaseView: InteractiveDatabaseView,
        onMathClick: (node, pos) => editMath(node.type.name === 'inlineMath', node.attrs.latex, pos)
      }),
      FileHandler.configure({
        allowedMimeTypes: IMAGE_TYPES,
        onPaste: (editor, files) => void insertImages(editor, files),
        onDrop: (editor, files, pos) => void insertImages(editor, files, pos)
      }),
      BlockHandle,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Titre' : "Tapez '/' pour insérer un bloc"
      }),
      SlashCommands
    ],
    editorProps: {
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest('a')
        const href = anchor?.getAttribute('href')
        if (!href) return false
        const target = pageIdFromHref(href)
        if (target) open(target)
        else window.open(href)
        return true
      }
    },
    content: JSON.parse(page.content),
    onUpdate: ({ editor }) => schedule({ content: JSON.stringify(editor.getJSON()) })
  })

  const crumbs = ancestorsOf(pages, page.id)
  useEffect(() => {
    const onInsert = (e: Event): void => editMath((e as CustomEvent<boolean>).detail, '', null)
    window.addEventListener('notionix:insert-math', onInsert)
    return () => window.removeEventListener('notionix:insert-math', onInsert)
  })

  return (
    <div className="page">
      <div className="breadcrumbs">
        {crumbs.map((c) => (
          <button key={c.id} onClick={() => open(c.id)}>
            {c.icon ?? ''} {c.title || 'Sans titre'}
          </button>
        ))}
        <span>
          {summary?.icon ?? ''} {title || 'Sans titre'}
        </span>
      </div>
      {summary && <PageDecorations page={summary} />}
      <div className="page-body">
        <input
          className="page-title"
          value={title}
          placeholder="Sans titre"
          autoFocus={!page.title}
          onChange={(e) => {
            setTitle(e.target.value)
            schedule({ title: e.target.value })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (editor) {
                editor.commands.setTextSelection(1)
                editor.view.focus()
              }
            }
          }}
        />
        {isRow && <RowProperties rowId={page.id} />}
        <EditorContent editor={editor} className="editor" />
        {editor && <TextBubbleMenu editor={editor} />}
        {editor && <TableBubbleMenu editor={editor} />}
      </div>
    </div>
  )
}
