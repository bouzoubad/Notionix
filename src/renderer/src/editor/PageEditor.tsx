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

  const editor = useEditor({
    extensions: [
      ...createDocumentExtensions(lowlight, { callout: InteractiveCallout }),
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
        <EditorContent editor={editor} className="editor" />
        {editor && <TextBubbleMenu editor={editor} />}
        {editor && <TableBubbleMenu editor={editor} />}
      </div>
    </div>
  )
}
