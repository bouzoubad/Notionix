import type { PageOptions, PageSummary } from '../../../shared/types'
import { atLeast } from '../../../shared/types'
import { useStore } from '../store'
import { Popover } from '../database/Popover'

const FONTS: { value: NonNullable<PageOptions['font']>; label: string; sample: string }[] = [
  { value: 'default', label: 'Par défaut', sample: 'Ag' },
  { value: 'serif', label: 'Serif', sample: 'Ag' },
  { value: 'mono', label: 'Mono', sample: 'Ag' }
]

/** Page layout options and lock, plus the page's actions. */
export function PageOptionsMenu({
  page,
  onClose
}: {
  page: PageSummary
  onClose: () => void
}): React.JSX.Element {
  const patch = useStore((s) => s.patch)
  const exportPage = useStore((s) => s.exportPage)
  const duplicate = useStore((s) => s.duplicate)
  const trash = useStore((s) => s.trash)
  const canEdit = atLeast(page.level, 'edit')
  const options = page.options
  const set = (next: Partial<PageOptions>): void =>
    void patch(page.id, { options: { ...options, ...next } })

  return (
    <Popover onClose={onClose} align="right" className="page-options">
      {page.kind === 'page' && (
        <div className="font-choice">
          {FONTS.map((f) => (
            <button
              key={f.value}
              disabled={!canEdit || options.locked}
              className={(options.font ?? 'default') === f.value ? 'active' : ''}
              onClick={() => set({ font: f.value })}
            >
              <span className={`font-sample font-${f.value}`}>{f.sample}</span>
              {f.label}
            </button>
          ))}
        </div>
      )}
      <label className="option-row">
        Petit texte
        <input
          type="checkbox"
          disabled={!canEdit || options.locked}
          checked={!!options.smallText}
          onChange={(e) => set({ smallText: e.target.checked })}
        />
      </label>
      <label className="option-row">
        Pleine largeur
        <input
          type="checkbox"
          disabled={!canEdit || options.locked}
          checked={!!options.fullWidth}
          onChange={(e) => set({ fullWidth: e.target.checked })}
        />
      </label>
      <label className="option-row">
        Verrouiller la page
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={!!options.locked}
          onChange={(e) => set({ locked: e.target.checked })}
        />
      </label>
      <hr />
      <button onClick={() => (onClose(), void patch(page.id, { favorite: !page.favorite }))}>
        {page.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      </button>
      <button onClick={() => (onClose(), void duplicate(page.id))}>Dupliquer</button>
      <button onClick={() => (onClose(), void exportPage(page.id))}>Exporter en Markdown</button>
      {canEdit && (
        <button onClick={() => (onClose(), void trash(page.id))}>Mettre à la corbeille</button>
      )}
    </Popover>
  )
}
