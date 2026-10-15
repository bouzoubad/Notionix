import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { common, createLowlight } from 'lowlight'
import type { Page } from '../../../shared/types'
import { createDocumentExtensions, pageIdFromHref } from '../../../shared/editorExtensions'
import { useStore } from '../store'
import { SlashCommands } from './slashCommands'
import { FileHandler } from '@tiptap/extension-file-handler'
import { InteractiveCallout } from './CalloutView'
import { BlockHandle } from './blockHandle'
import { TableBubbleMenu, TextBubbleMenu } from './BubbleMenus'
import { IMAGE_TYPES, insertImages } from './images'
import { PageDecorations } from '../components/PageDecorations'
import { RowProperties } from '../database/RowProperties'
import { InteractiveDatabaseView } from '../database/InlineDatabase'
import { canEditPage, platform, type SharedPage } from '../platform'
import { PageTopBar } from '../components/PageTopBar'

const lowlight = createLowlight(common)
const SAVE_DELAY_MS = 400

export function PageEditor({ pageId }: { pageId: string }): React.JSX.Element | null {
  const [loaded, setLoaded] = useState<{ id: string; page: Page | null } | null>(null)
  const contentReload = useStore((s) => s.contentReload)
  useEffect(() => {
    let cancelled = false
    window.api.pages.get(pageId).then((page) => {
      if (!cancelled) setLoaded({ id: pageId, page })
    })
    return () => {
      cancelled = true
    }
  }, [pageId, contentReload])
  // On a server, the page's content is a document edited together.
  const session = platform().session
  const [shared, setShared] = useState<{ id: string; page: SharedPage } | null>(null)
  useEffect(() => {
    if (!session) return
    let cancelled = false
    const opened = session.openPage(pageId)
    void opened.ready.then(() => {
      if (!cancelled) setShared({ id: pageId, page: opened })
    })
    return () => {
      cancelled = true
      opened.destroy()
    }
  }, [session, pageId])
  const page = loaded?.id === pageId ? loaded.page : null
  const sharedPage = shared?.id === pageId ? shared.page : null
  if (!page || (session && !sharedPage)) return null
  // A shared page follows its document; a local one is loaded again after a restore.
  return (
    <LoadedEditor
      key={sharedPage ? page.id : `${page.id}:${page.version}`}
      page={page}
      shared={sharedPage}
    />
  )
}

function LoadedEditor({
  page,
  shared
}: {
  page: Page
  shared: SharedPage | null
}): React.JSX.Element {
  const patch = useStore((s) => s.patch)
  const pages = useStore((s) => s.pages)
  const open = useStore((s) => s.open)
  const summary = pages.find((p) => p.id === page.id)
  const [title, setTitle] = useState(page.title)
  const isRow = pages.some((p) => p.id === page.parentId && p.kind === 'database')
  const pending = useRef<{ content?: string; title?: string }>({})
  const timer = useRef<number | undefined>(undefined)
  const titleInput = useRef<HTMLInputElement>(null)
  const editable = summary ? canEditPage(summary) : false

  // A title renamed by someone else shows up unless this person is typing one.
  const remoteTitle = summary?.title
  useEffect(() => {
    if (remoteTitle === undefined || pending.current.title !== undefined) return
    if (document.activeElement !== titleInput.current) setTitle(remoteTitle)
  }, [remoteTitle])

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
        onMathClick: (node, pos) =>
          editMath(node.type.name === 'inlineMath', node.attrs.latex, pos),
        imageSrc: platform().imageSrc,
        collaboration: shared?.extensions
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
    editable,
    // A shared page gets its content from the server's document.
    ...(shared
      ? {}
      : {
          content: JSON.parse(page.content),
          onUpdate: ({ editor }) => schedule({ content: JSON.stringify(editor.getJSON()) })
        })
  })

  // Sharing or locking can change while the page is open.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])
  useEffect(() => {
    const onInsert = (e: Event): void => editMath((e as CustomEvent<boolean>).detail, '', null)
    window.addEventListener('notionix:insert-math', onInsert)
    return () => window.removeEventListener('notionix:insert-math', onInsert)
  })

  return (
    <div className="page">
      {summary && <PageTopBar page={summary} title={title} />}
      {summary && <PageDecorations page={summary} />}
      <div className="page-body">
        <input
          ref={titleInput}
          className="page-title"
          value={title}
          readOnly={!editable}
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
