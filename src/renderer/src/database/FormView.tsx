import { useState } from 'react'
import {
  READ_ONLY_TYPES,
  TITLE_PROPERTY_ID,
  isComputed,
  randomId,
  type DatabaseRow,
  type PropertyValue
} from '../../../shared/database'
import { Cell } from './Cell'
import { platform } from '../platform'
import { copyText } from '../clipboard'
import { TYPE_ICONS, visibleProperties, type ViewProps } from './viewTypes'
import { t, tx } from '../../../shared/i18n'

const emptyRow = (): DatabaseRow => ({
  id: 'form',
  title: '',
  icon: null,
  cover: null,
  properties: {},
  isTemplate: false,
  position: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdBy: null,
  updatedBy: null
})

/** A form adding a row: one field per property shown in the view. */
export function FormView({
  schema,
  view,
  onAddRow,
  onCreateOption,
  onSchema
}: ViewProps): React.JSX.Element {
  const web = platform().kind === 'web'
  const link = view.formToken ? `${location.origin}/f/${view.formToken}` : null
  const share = (on: boolean): void =>
    onSchema({
      ...schema,
      views: schema.views.map((v) =>
        v.id === view.id ? { ...v, formToken: on ? randomId(24) : null } : v
      )
    })
  const [draft, setDraft] = useState<DatabaseRow>(emptyRow)
  const [sent, setSent] = useState(0)
  const fields = visibleProperties(schema, view).filter(
    (p) => !isComputed(p.type) || p.id === TITLE_PROPERTY_ID
  )
  const editable = fields.filter((p) => !READ_ONLY_TYPES.has(p.type))
  const set = (propId: string, value: PropertyValue): void =>
    setDraft((d) =>
      propId === TITLE_PROPERTY_ID
        ? { ...d, title: typeof value === 'string' ? value : '' }
        : { ...d, properties: { ...d.properties, [propId]: value } }
    )
  const submit = (): void => {
    onAddRow({ ...draft.properties, title: draft.title })
    setDraft(emptyRow())
    setSent((n) => n + 1)
  }
  return (
    <div className="form-view">
      {web && (
        <div className="form-share">
          <label>
            <input type="checkbox" checked={!!link} onChange={(e) => share(e.target.checked)} />{' '}
            {t('Formulaire public : n’importe qui ayant le lien peut répondre, sans compte')}
          </label>
          {link && (
            <span className="share-public-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button onClick={() => void copyText(link)}>{t('Copier')}</button>
            </span>
          )}
        </div>
      )}
      <h3>{view.name}</h3>
      {editable.map((p) => (
        <label key={p.id} className="form-field">
          <span className="form-label">
            <span className="type-icon">{TYPE_ICONS[p.type]}</span> {p.name}
          </span>
          <Cell
            key={`${p.id}-${sent}`}
            prop={p}
            row={draft}
            onChange={(value) => set(p.id, value)}
            onCreateOption={onCreateOption}
          />
        </label>
      ))}
      <div className="form-actions">
        <button className="primary" onClick={submit} disabled={!draft.title.trim()}>
          {tx('formulaire', 'Envoyer')}
        </button>
        {sent > 0 && <span className="muted">{t('Réponse ajoutée à la base.')}</span>}
      </div>
    </div>
  )
}
