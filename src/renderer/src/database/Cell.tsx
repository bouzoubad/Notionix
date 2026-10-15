import { useEffect, useState } from 'react'
import {
  OPTION_COLORS,
  STATUS_GROUP_LABELS,
  displayValue,
  fileEntry,
  fileValue,
  newId,
  parseNumber,
  rowValue,
  type DatabaseRow,
  type DateValue,
  type PropertyDef,
  type PropertyValue,
  type SelectOption
} from '../../../shared/database'
import { useStore } from '../store'
import { platform } from '../platform'
import { OptionTag } from './OptionTag'
import { ComputedValue } from './ComputedEditors'
import { Popover } from './Popover'
import { locale, t, tx } from '../../../shared/i18n'

export interface CellProps {
  prop: PropertyDef
  row: DatabaseRow
  onChange: (value: PropertyValue) => void
  /** Adds an option to a select property and resolves with its id */
  onCreateOption: (prop: PropertyDef, option: SelectOption) => Promise<void>
}

const READ_ONLY = new Set(['created_time', 'last_edited_time', 'unique_id'])

/** Displays a property value and edits it in place, according to its type. */
export function Cell(props: CellProps): React.JSX.Element {
  const { prop, row } = props
  const value = rowValue(row, prop)
  if (prop.type === 'formula' || prop.type === 'rollup') return <ComputedValue value={value} />
  if (READ_ONLY.has(prop.type))
    return <div className="cell readonly">{displayValue(prop, value)}</div>
  switch (prop.type) {
    case 'checkbox':
      return (
        <div className="cell">
          <input
            type="checkbox"
            aria-label={prop.name}
            checked={value === true}
            onChange={(e) => props.onChange(e.target.checked)}
          />
        </div>
      )
    case 'select':
    case 'multi_select':
    case 'status':
      return <SelectCell {...props} />
    case 'person':
      return <PersonCell {...props} />
    case 'created_by':
    case 'last_edited_by':
      return (
        <div className="cell readonly">
          <People ids={Array.isArray(value) ? (value as string[]) : []} />
        </div>
      )
    case 'files':
      return <FilesCell {...props} />
    case 'date':
      return <DateCell {...props} />
    case 'relation':
      return <RelationCell {...props} />
    default:
      return <TextCell {...props} />
  }
}

function TextCell({ prop, row, onChange }: CellProps): React.JSX.Element {
  const value = rowValue(row, prop)
  const shown =
    prop.type === 'number' && typeof value === 'number'
      ? value.toLocaleString(locale())
      : displayValue(prop, value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const commit = (): void => {
    setEditing(false)
    const text = draft.trim()
    if (prop.type === 'number') onChange(text ? parseNumber(text) : null)
    else onChange(prop.type === 'title' ? draft : text || null)
  }
  if (editing) {
    return (
      <div className="cell editing">
        <input
          autoFocus
          aria-label={prop.name}
          inputMode={prop.type === 'number' ? 'decimal' : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }
  const link =
    prop.type === 'url' && typeof value === 'string'
      ? /^https?:\/\//i.test(value)
        ? value
        : `https://${value}`
      : prop.type === 'email' && typeof value === 'string'
        ? `mailto:${value}`
        : null
  return (
    <div
      className={`cell ${prop.type === 'number' ? 'number' : ''} ${prop.type === 'title' ? 'title-cell' : ''}`}
      tabIndex={0}
      onClick={() => {
        setDraft(
          prop.type === 'number' && typeof value === 'number'
            ? String(value)
            : displayValue(prop, value)
        )
        setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setDraft(displayValue(prop, value))
          setEditing(true)
        }
      }}
    >
      {link ? (
        <a href={link} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer">
          {shown}
        </a>
      ) : (
        shown ||
        (prop.type === 'title' ? <span className="placeholder">{t('Sans titre')}</span> : '')
      )}
    </div>
  )
}

function SelectCell({ prop, row, onChange, onCreateOption }: CellProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const raw = row.properties[prop.id] ?? null
  const selected: string[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const options = prop.options ?? []
  const multi = prop.type === 'multi_select'
  const toggle = (id: string): void => {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
      onChange(next.length ? next : null)
    } else {
      onChange(selected[0] === id ? null : id)
      setOpen(false)
    }
  }
  const matching = options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
  const exact = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase())
  const create = async (): Promise<void> => {
    const option = {
      id: newId(),
      name: query.trim(),
      color: OPTION_COLORS[options.length % OPTION_COLORS.length]
    }
    setQuery('')
    await onCreateOption(prop, option)
    toggle(option.id)
  }
  return (
    <div className="cell" tabIndex={0} onClick={() => setOpen(true)}>
      <span className="tags">
        {selected.map((id) => {
          const option = options.find((o) => o.id === id)
          return option ? <OptionTag key={id} option={option} /> : null
        })}
      </span>
      {open && (
        <Popover onClose={() => setOpen(false)} className="select-popover">
          <div className="select-current">
            {selected.map((id) => {
              const option = options.find((o) => o.id === id)
              return option ? (
                <OptionTag key={id} option={option} onRemove={() => toggle(id)} />
              ) : null
            })}
            <input
              autoFocus
              placeholder={
                options.length ? t('Rechercher ou créer une option') : t('Créer une option')
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  // Like Notion: Enter picks the first matching option, and creates one only when none matches.
                  if (matching[0]) toggle(matching[0].id)
                  else if (query.trim()) void create()
                }
              }}
            />
          </div>
          <div className="select-options">
            {matching.map((o, i) => (
              <span key={o.id}>
                {prop.type === 'status' && o.group !== matching[i - 1]?.group && (
                  <div className="menu-label">{STATUS_GROUP_LABELS[o.group ?? 'todo']}</div>
                )}
                <button className="select-option" onClick={() => toggle(o.id)}>
                  <OptionTag option={o} />
                  {selected.includes(o.id) && <span className="check">✓</span>}
                </button>
              </span>
            ))}
            {query.trim() && !exact && prop.type !== 'status' && (
              <button className="select-option" onClick={() => void create()}>
                {t('Créer')}{' '}
                <OptionTag
                  option={{
                    id: 'new',
                    name: query.trim(),
                    color: OPTION_COLORS[options.length % OPTION_COLORS.length]
                  }}
                />
              </button>
            )}
          </div>
        </Popover>
      )}
    </div>
  )
}

function DateCell({ prop, row, onChange }: CellProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const value = (row.properties[prop.id] as DateValue | undefined) ?? null
  const withTime = !!value?.start.includes('T')
  const kind = withTime ? 'datetime-local' : 'date'
  const set = (next: Partial<DateValue> & { time?: boolean }): void => {
    const time = next.time ?? withTime
    const convert = (s: string | null | undefined): string | null =>
      !s ? null : time ? (s.includes('T') ? s : `${s}T09:00`) : s.slice(0, 10)
    const start = convert(next.start ?? value?.start)
    const end = convert(next.end === undefined ? value?.end : next.end)
    onChange(start ? (end ? { start, end } : { start }) : null)
  }
  return (
    <div className="cell" tabIndex={0} onClick={() => setOpen(true)}>
      {displayValue(prop, value)}
      {open && (
        <Popover onClose={() => setOpen(false)} className="date-popover">
          <label>
            {t('Début')}
            <input
              type={kind}
              value={value?.start ?? ''}
              onChange={(e) => set({ start: e.target.value })}
            />
          </label>
          {value?.end !== undefined && value?.end !== null ? (
            <label>
              {t('Fin')}
              <input
                type={kind}
                value={value.end}
                onChange={(e) => set({ end: e.target.value || null })}
              />
            </label>
          ) : null}
          <div className="date-actions">
            <label>
              <input
                type="checkbox"
                checked={!!value?.end}
                disabled={!value}
                onChange={(e) => set({ end: e.target.checked ? value?.start : null })}
              />
              {t('Date de fin')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={withTime}
                disabled={!value}
                onChange={(e) => set({ time: e.target.checked })}
              />
              {t('Heure')}
            </label>
            <button onClick={() => (onChange(null), setOpen(false))}>{t('Effacer')}</button>
          </div>
        </Popover>
      )}
    </div>
  )
}

function RelationCell({ prop, row, onChange }: CellProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<DatabaseRow[] | null>(null)
  const [query, setQuery] = useState('')
  const pages = useStore((s) => s.pages)
  const openPage = useStore((s) => s.open)
  const raw = row.properties[prop.id]
  const selected: string[] = Array.isArray(raw) ? raw : []
  const titleOf = (id: string): string | undefined => {
    const page = pages.find((p) => p.id === id && !p.trashedAt)
    return page ? page.title || t('Sans titre') : undefined
  }
  useEffect(() => {
    if (!open || !prop.relationDatabaseId) return
    let cancelled = false
    window.api.databases.get(prop.relationDatabaseId).then((d) => {
      if (!cancelled) setTargets(d ? d.rows.filter((r) => !r.isTemplate) : [])
    })
    return () => {
      cancelled = true
    }
  }, [open, prop.relationDatabaseId])
  const toggle = (id: string): void => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    onChange(next.length ? next : null)
  }
  return (
    <div className="cell" tabIndex={0} onClick={() => setOpen(true)}>
      <span className="tags">
        {selected.map((id) =>
          titleOf(id) !== undefined ? (
            <button
              key={id}
              className="relation-chip"
              onClick={(e) => {
                e.stopPropagation()
                openPage(id)
              }}
            >
              📄 {titleOf(id)}
            </button>
          ) : null
        )}
      </span>
      {open && (
        <Popover onClose={() => setOpen(false)} className="select-popover">
          {!prop.relationDatabaseId ? (
            <p className="hint">{t('Choisissez la base liée dans le menu de la propriété.')}</p>
          ) : (
            <>
              <div className="select-current">
                <input
                  autoFocus
                  placeholder={t('Rechercher une page')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="select-options">
                {(targets ?? [])
                  .filter((target) =>
                    target.title.toLowerCase().includes(query.trim().toLowerCase())
                  )
                  .map((target) => (
                    <button
                      key={target.id}
                      className="select-option"
                      onClick={() => toggle(target.id)}
                    >
                      <span>📄 {target.title || t('Sans titre')}</span>
                      {selected.includes(target.id) && <span className="check">✓</span>}
                    </button>
                  ))}
                {targets?.length === 0 && <p className="hint">{t('La base liée est vide.')}</p>}
              </div>
            </>
          )}
        </Popover>
      )}
    </div>
  )
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

/** People as small badges with their names. */
export function People({ ids }: { ids: string[] }): React.JSX.Element {
  const people = useStore((s) => s.people)
  return (
    <span className="tags">
      {ids.map((id) => {
        const p = people.find((x) => x.id === id)
        return (
          <span key={id} className="person-chip">
            <span className="person-avatar">{initials(p?.name ?? '?')}</span>
            {p?.name ?? t('Compte supprimé')}
          </span>
        )
      })}
    </span>
  )
}

function PersonCell({ prop, row, onChange }: CellProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const people = useStore((s) => s.people)
  const raw = row.properties[prop.id]
  const selected: string[] = Array.isArray(raw) ? raw : []
  const toggle = (id: string): void => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    onChange(next.length ? next : null)
  }
  const matching = people.filter(
    (p) => !p.disabled && p.name.toLowerCase().includes(query.trim().toLowerCase())
  )
  return (
    <div className="cell" tabIndex={0} onClick={() => setOpen(true)}>
      <People ids={selected} />
      {open && (
        <Popover onClose={() => setOpen(false)} className="select-popover">
          <div className="select-current">
            <input
              autoFocus
              placeholder={t('Rechercher une personne')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && matching[0] && toggle(matching[0].id)}
            />
          </div>
          <div className="select-options">
            {matching.map((p) => (
              <button key={p.id} className="select-option" onClick={() => toggle(p.id)}>
                <span className="person-chip">
                  <span className="person-avatar">{initials(p.name)}</span>
                  {p.name}
                  {p.id === (platform().session?.user.id ?? 'local') ? t(' (vous)') : ''}
                </span>
                {selected.includes(p.id) && <span className="check">✓</span>}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

function FilesCell({ prop, row, onChange }: CellProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const showNotice = useStore((s) => s.showNotice)
  const raw = row.properties[prop.id]
  const files: string[] = Array.isArray(raw) ? raw : []
  const add = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => {
      setBusy(true)
      const added: string[] = []
      for (const file of input.files ?? []) {
        try {
          const src = await window.api.assets.saveFile(
            new Uint8Array(await file.arrayBuffer()),
            file.name
          )
          added.push(fileValue(src, file.name))
        } catch (e) {
          showNotice(
            t('Fichier non ajouté ({name}) : {error}', {
              name: file.name,
              error: e instanceof Error ? e.message : String(e)
            })
          )
        }
      }
      setBusy(false)
      if (added.length) onChange([...files, ...added])
    }
    input.click()
  }
  return (
    <div className="cell" tabIndex={0} onClick={() => setOpen(true)}>
      <span className="tags">
        {files.map((f) => (
          <span key={f} className="file-chip">
            📎 {fileEntry(f).name}
          </span>
        ))}
      </span>
      {open && (
        <Popover onClose={() => setOpen(false)} className="select-popover">
          <div className="select-options">
            {files.map((f) => {
              const { src, name } = fileEntry(f)
              return (
                <div key={f} className="file-row">
                  <button onClick={() => void window.api.assets.download(src, name)}>
                    📎 {name}
                  </button>
                  <button
                    title={t('Retirer')}
                    onClick={() => {
                      const next = files.filter((x) => x !== f)
                      onChange(next.length ? next : null)
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            <button className="select-option" disabled={busy} onClick={add}>
              {busy ? tx('fichier', 'Envoi…') : t('+ Ajouter un fichier')}
            </button>
          </div>
        </Popover>
      )}
    </div>
  )
}
