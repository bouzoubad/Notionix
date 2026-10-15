import { useState } from 'react'
import { PageIcon } from './PageIcon'
import type { PageSummary } from '../../../shared/types'
import { useStore } from '../store'
import { BUILT_IN_TEMPLATES, type Template } from '../templates'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Ready-made pages, and the pages saved as templates in the workspace. */
export function TemplatesDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const load = useStore((s) => s.load)
  const open = useStore((s) => s.open)
  const patch = useStore((s) => s.patch)
  const showNotice = useStore((s) => s.showNotice)
  const [busy, setBusy] = useState<string | null>(null)
  const mine = pages.filter((p) => p.options.template && !p.trashedAt)

  const createFrom = async (key: string, run: () => Promise<string>): Promise<void> => {
    setBusy(key)
    try {
      const id = await run()
      await load()
      open(id)
      onClose()
    } catch (e) {
      showNotice(`Modèle non créé : ${message(e)}`)
      setBusy(null)
    }
  }
  const fromBuiltIn = (t: Template): Promise<void> => createFrom(t.id, () => t.create(null))
  // A page saved as a template is copied to the top level, without the template mark.
  const fromPage = (page: PageSummary): Promise<void> =>
    createFrom(page.id, async () => {
      const copy = await window.api.pages.duplicate(page.id)
      await window.api.pages.move(copy.id, null, 0)
      await patch(copy.id, {
        title: page.title,
        options: { ...copy.options, template: false }
      })
      return copy.id
    })

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog templates" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Modèles</h3>
        <div className="results">
          <div className="template-grid">
            {BUILT_IN_TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="template-card"
                disabled={busy !== null}
                onClick={() => void fromBuiltIn(t)}
              >
                <span className="template-icon">{t.icon}</span>
                <strong>{t.name}</strong>
                <span>{busy === t.id ? 'Création…' : t.description}</span>
              </button>
            ))}
          </div>
          <div className="menu-label">Modèles de l’espace</div>
          {mine.length === 0 ? (
            <p className="inbox-empty">
              Aucun pour l’instant : menu « ⋯ » d’une page, « Enregistrer comme modèle ».
            </p>
          ) : (
            <div className="template-grid">
              {mine.map((p) => (
                <button
                  key={p.id}
                  className="template-card"
                  disabled={busy !== null}
                  onClick={() => void fromPage(p)}
                >
                  <span className="template-icon">
                    <PageIcon icon={p.icon} fallback="📄" />
                  </span>
                  <strong>{p.title || 'Sans titre'}</strong>
                  <span>
                    {busy === p.id ? 'Création…' : 'Copie de la page et de ses sous-pages'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
