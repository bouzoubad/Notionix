import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import type { Page } from '../../../shared/types'
import { ancestorsOf, useStore } from '../store'
import { SlashCommands } from './slashCommands'

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
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }),
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Titre' : "Tapez '/' pour insérer un bloc"
      }),
      SlashCommands
    ],
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
      </div>
    </div>
  )
}
