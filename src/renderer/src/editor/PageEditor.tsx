import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { common, createLowlight } from 'lowlight'
import type { Page } from '../../../shared/types'
import { createDocumentExtensions, pageIdFromHref } from '../../../shared/editorExtensions'
import { pageHash, useStore } from '../store'
import { SlashCommands } from './slashCommands'
import { InteractiveMention, MentionSuggestion, PageLinkSuggestion } from './mentions'
import { NotionShortcuts } from './shortcuts'
import { FileHandler } from '@tiptap/extension-file-handler'
import { InteractiveCallout } from './CalloutView'
import { BlockHandle } from './blockHandle'
import { BlockMenu } from './BlockMenu'
import { TableBubbleMenu, TextBubbleMenu } from './BubbleMenus'
import { IMAGE_TYPES, insertImages } from './images'
import { BLOCK_VIEWS, insertFiles } from './blockViews'
import type { Editor } from '@tiptap/core'
import { PageDecorations } from '../components/PageDecorations'
import { RowProperties } from '../database/RowProperties'
import { InteractiveDatabaseView } from '../database/InlineDatabase'
import { canEditPage, platform, type SharedPage } from '../platform'
import { PageTopBar } from '../components/PageTopBar'
import { pageOptionClasses } from '../pageOptions'
import { CommentsPanel } from '../components/CommentsPanel'
import { Backlinks } from '../components/Backlinks'

const lowlight = createLowlight(common)

async function dropFiles(editor: Editor, files: File[], pos?: number): Promise<void> {
  const images = files.filter((f) => IMAGE_TYPES.includes(f.type))
  const others = files.filter((f) => !IMAGE_TYPES.includes(f.type))
  if (images.length) await insertImages(editor, images, pos)
  if (others.length) await insertFiles(editor, others, images.length ? undefined : pos)
}
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
  const commentsOpen = useStore((s) => s.comments.open)

  // A title renamed by someone else shows up unless this person is typing one.
  const remoteTitle = summary?.title
  useEffect(() => {
    if (remoteTitle === undefined || pending.current.title !== undefined) return
    // An empty title (focused on its own when the page opens) takes the other's at once.
    setTitle((current) =>
      current === '' || document.activeElement !== titleInput.current ? remoteTitle : current
    )
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
        mention: InteractiveMention,
        views: BLOCK_VIEWS,
        collaboration: shared?.extensions
      }),
      // Images are checked as images; other files become file, video or audio blocks.
      FileHandler.configure({
        onPaste: (editor, files) => void dropFiles(editor, files),
        onDrop: (editor, files, pos) => void dropFiles(editor, files, pos)
      }),
      BlockHandle,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Titre' : "Tapez '/' pour insérer un bloc"
      }),
      SlashCommands,
      MentionSuggestion,
      PageLinkSuggestion,
      NotionShortcuts
    ],
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Contenu de la page'
      },
      handleClick: (_view, _pos, event) => {
        // Clicking discussed text shows its discussion.
        const discussed = (event.target as HTMLElement).closest('[data-thread]')
        if (discussed) useStore.getState().openComments(discussed.getAttribute('data-thread'))
        const anchor = (event.target as HTMLElement).closest('a')
        const href = anchor?.getAttribute('href')
        if (!href) return false
        const target = pageIdFromHref(href)
        if (target && (event.metaKey || event.ctrlKey) && platform().kind === 'web')
          window.open(pageHash(target), '_blank')
        else if (target) open(target)
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
    <div className={`page ${summary ? pageOptionClasses(summary.options) : ''}`}>
      {summary && <PageTopBar page={summary} title={title} />}
      {summary && <PageDecorations page={summary} />}
      <div className="page-body">
        <input
          ref={titleInput}
          className="page-title"
          aria-label="Titre de la page"
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
        <Backlinks pageId={page.id} />
        {isRow && <RowProperties rowId={page.id} />}
        <EditorContent editor={editor} className="editor" />
        {editor && <TextBubbleMenu editor={editor} />}
        {editor && <BlockMenu editor={editor} />}
        {commentsOpen && summary && <CommentsPanel page={summary} editor={editor} />}
        {editor && <TableBubbleMenu editor={editor} />}
      </div>
    </div>
  )
}
