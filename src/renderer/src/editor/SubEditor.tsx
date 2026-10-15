import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Extensions } from '@tiptap/core'
import { common, createLowlight } from 'lowlight'
import { createDocumentExtensions } from '../../../shared/editorExtensions'
import { platform, type SharedPage } from '../platform'
import { t } from '../../../shared/i18n'

const lowlight = createLowlight(common)
const SAVE_DELAY_MS = 400

/**
 * An editor inside a block: the content of another page (synced block). On a
 * server it joins that page's shared document; in the desktop app it saves to
 * the page.
 */
export function PageSubEditor({
  pageId,
  editable
}: {
  pageId: string
  editable: boolean
}): React.JSX.Element {
  const session = platform().session
  const [state, setState] = useState<
    { id: string; content: unknown; shared: SharedPage | null } | 'missing' | null
  >(null)

  useEffect(() => {
    let cancelled = false
    let shared: SharedPage | null = null
    void (async () => {
      const page = await window.api.pages.get(pageId).catch(() => null)
      if (cancelled) return
      if (!page) return setState('missing')
      if (session) {
        shared = session.openPage(pageId)
        await shared.ready
        if (cancelled) return
      }
      setState({ id: pageId, content: JSON.parse(page.content), shared })
    })()
    return () => {
      cancelled = true
      shared?.destroy()
    }
  }, [pageId, session])

  if (state === 'missing')
    return <div className="synced-missing">{t('Contenu synchronisé inaccessible.')}</div>
  if (!state || state.id !== pageId) return <div className="synced-loading">{t('Chargement…')}</div>
  return (
    <SubEditor
      key={pageId}
      content={state.shared ? undefined : state.content}
      collaboration={state.shared?.extensions}
      editable={editable}
      onChange={
        state.shared
          ? undefined
          : (json) => void window.api.pages.update(pageId, { content: JSON.stringify(json) })
      }
    />
  )
}

/** A small editor with the document schema; `onChange` receives the JSON, debounced. */
export function SubEditor({
  content,
  collaboration,
  editable,
  onChange,
  className = ''
}: {
  content?: unknown
  collaboration?: Extensions
  editable: boolean
  onChange?: (json: unknown) => void
  className?: string
}): React.JSX.Element {
  const timer = useRef<number | undefined>(undefined)
  const dirty = useRef(false)
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  const editor = useEditor({
    extensions: createDocumentExtensions(lowlight, {
      imageSrc: platform().imageSrc,
      collaboration
    }),
    editable,
    ...(collaboration
      ? {}
      : { content: (content as object) ?? { type: 'doc', content: [{ type: 'paragraph' }] } }),
    onUpdate: ({ editor }) => {
      if (!latest.current) return
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        dirty.current = false
        latest.current?.(editor.getJSON())
      }, SAVE_DELAY_MS)
    }
  })
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])
  useEffect(
    () => () => {
      // Leaving saves what is pending.
      window.clearTimeout(timer.current)
      if (dirty.current && editor && latest.current) latest.current(editor.getJSON())
    },
    [editor]
  )
  return <EditorContent editor={editor} className={`editor sub-editor ${className}`} />
}
