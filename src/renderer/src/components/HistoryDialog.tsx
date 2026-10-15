import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { common, createLowlight } from 'lowlight'
import type { PageSummary, PageVersion } from '../../../shared/types'
import { createDocumentExtensions } from '../../../shared/editorExtensions'
import { useStore } from '../store'
import { canEditPage, platform } from '../platform'
import { locale, t } from '../../../shared/i18n'

const lowlight = createLowlight(common)

const when = (ms: number): string =>
  new Date(ms).toLocaleString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Saved states of a page: pick one to look at it, then restore it. */
export function HistoryDialog({
  page,
  onClose
}: {
  page: PageSummary
  onClose: () => void
}): React.JSX.Element {
  const people = useStore((s) => s.people)
  const showNotice = useStore((s) => s.showNotice)
  const reloadContent = useStore((s) => s.reloadContent)
  const [versions, setVersions] = useState<PageVersion[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [content, setContent] = useState<{ id: number; json: unknown } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.pages.versions(page.id).then((v) => {
      if (cancelled) return
      setVersions(v)
      setSelected(v[0]?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [page.id])

  useEffect(() => {
    if (selected === null) return
    let cancelled = false
    window.api.pages.version(selected).then((v) => {
      if (!cancelled && v) setContent({ id: v.id, json: JSON.parse(v.content) })
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  const names = (ids: string[]): string =>
    ids.map((id) => people.find((p) => p.id === id)?.name ?? t('Compte supprimé')).join(', ') ||
    t('Inconnu')

  const restore = async (): Promise<void> => {
    if (selected === null) return
    setBusy(true)
    try {
      await window.api.pages.restoreVersion(page.id, selected)
      reloadContent()
      showNotice(t('Version restaurée.'))
      onClose()
    } catch (e) {
      showNotice(
        t('Restauration impossible : {error}', {
          error: e instanceof Error ? e.message : String(e)
        })
      )
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog history" onMouseDown={(e) => e.stopPropagation()}>
        <div className="history-preview">
          {content && content.id === selected ? (
            <Preview key={content.id} json={content.json} />
          ) : (
            <p className="history-empty">
              {versions?.length === 0
                ? t(
                    'Aucune version enregistrée pour l’instant : elles apparaissent dès les premières modifications.'
                  )
                : t('Chargement…')}
            </p>
          )}
        </div>
        <aside className="history-list">
          <h3>{t('Historique')}</h3>
          {versions?.map((v, i) => (
            <button
              key={v.id}
              className={v.id === selected ? 'active' : ''}
              onClick={() => setSelected(v.id)}
            >
              <span className="history-date">
                {when(v.createdAt)}
                {i === 0 ? t(' · actuelle') : ''}
              </span>
              <span className="history-authors">{names(v.authors)}</span>
            </button>
          ))}
          <div className="history-actions">
            <button onClick={onClose}>{t('Fermer')}</button>
            <button
              className="primary"
              disabled={
                busy || selected === null || selected === versions?.[0]?.id || !canEditPage(page)
              }
              onClick={() => void restore()}
            >
              {t('Restaurer cette version')}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Preview({ json }: { json: unknown }): React.JSX.Element {
  const editor = useEditor({
    extensions: createDocumentExtensions(lowlight, { imageSrc: platform().imageSrc }),
    content: json as object,
    editable: false
  })
  return <EditorContent editor={editor} className="editor" />
}
