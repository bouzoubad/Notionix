import { useEffect, useState } from 'react'
import {
  ROLLUP_LABELS,
  isComputedError,
  type DatabaseSchema,
  type PropertyDef,
  type PropertyValue,
  type RollupAggregate
} from '../../../shared/database'
import { FORMULA_HELP, FormulaError, parseFormula } from '../../../shared/formula'
import { locale, t } from '../../../shared/i18n'

/** Read-only display of a formula or rollup value; errors are shown with their message. */
export function ComputedValue({ value }: { value: PropertyValue }): React.JSX.Element {
  if (isComputedError(value)) {
    return (
      <div className="cell readonly computed-error" title={value.error}>
        ⚠ {value.error}
      </div>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <div className="cell readonly">
        <input
          type="checkbox"
          checked={value}
          disabled
          aria-label={value ? t('vrai') : t('faux')}
        />
      </div>
    )
  }
  if (typeof value === 'number') {
    return (
      <div className="cell readonly number">
        {value.toLocaleString(locale(), { maximumFractionDigits: 10 })}
      </div>
    )
  }
  const text =
    value === null
      ? ''
      : Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'object'
          ? 'start' in value
            ? (value.end ? `${value.start} → ${value.end}` : value.start).replace(/T/g, ' ')
            : ''
          : value
  return <div className="cell readonly">{text}</div>
}

/** Formula editor in the property menu: validated as you type, with the function reference. */
export function FormulaEditor({
  prop,
  schema,
  onSave
}: {
  prop: PropertyDef
  schema: DatabaseSchema
  onSave: (formula: string) => void
}): React.JSX.Element {
  const [formula, setFormula] = useState(prop.formula ?? '')
  const [help, setHelp] = useState(false)
  let error: string | null = null
  if (formula.trim()) {
    try {
      parseFormula(formula)
    } catch (e) {
      error = e instanceof FormulaError ? e.message : t('Formule invalide.')
    }
  }
  const insert = (text: string): void =>
    setFormula((f) => (f && !f.endsWith(' ') ? `${f} ${text}` : f + text))
  return (
    <div className="formula-editor">
      <div className="menu-label">{t('Formule')}</div>
      <textarea
        aria-label={t('Formule')}
        spellCheck={false}
        value={formula}
        placeholder='prop("Prix") * 1.2'
        onChange={(e) => setFormula(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !error) onSave(formula)
        }}
      />
      <div className={error ? 'formula-status error' : 'formula-status'}>
        {error ?? t('Formule valide')}
      </div>
      <div className="formula-props">
        {schema.properties
          .filter((p) => p.id !== prop.id)
          .map((p) => (
            <button key={p.id} onClick={() => insert(`prop("${p.name}")`)}>
              {p.name}
            </button>
          ))}
      </div>
      <div className="formula-actions">
        <button onClick={() => setHelp(!help)}>
          {help ? t('Masquer l’aide') : t('Fonctions…')}
        </button>
        <button className="primary" disabled={!!error} onClick={() => onSave(formula)}>
          {t('Appliquer')}
        </button>
      </div>
      {help && (
        <ul className="formula-help">
          {FORMULA_HELP.map((h) => (
            <li key={h.syntax}>
              <code>{h.syntax}</code> {h.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Rollup settings: relation, property of the linked database, and how to aggregate it. */
export function RollupEditor({
  prop,
  schema,
  onChange
}: {
  prop: PropertyDef
  schema: DatabaseSchema
  onChange: (next: PropertyDef['rollup']) => void
}): React.JSX.Element {
  const cfg = prop.rollup ?? {
    relationPropertyId: null,
    targetPropertyId: null,
    aggregate: 'count' as RollupAggregate
  }
  const relations = schema.properties.filter((p) => p.type === 'relation')
  const relation = relations.find((p) => p.id === cfg.relationPropertyId)
  const [target, setTarget] = useState<{ id: string; schema: DatabaseSchema | null } | null>(null)
  const targetId = relation?.relationDatabaseId ?? null
  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    window.api.databases.get(targetId).then((d) => {
      if (!cancelled) setTarget({ id: targetId, schema: d?.schema ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [targetId])
  const targetProps = target?.id === targetId ? (target.schema?.properties ?? []) : []
  return (
    <div className="rollup-editor">
      <label className="menu-row">
        {t('Relation')}
        <select
          aria-label={t('Relation')}
          value={cfg.relationPropertyId ?? ''}
          onChange={(e) =>
            onChange({ ...cfg, relationPropertyId: e.target.value || null, targetPropertyId: null })
          }
        >
          <option value="">{t('Choisir…')}</option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {relations.length === 0 && (
        <p className="hint">{t('Ajoutez d’abord une propriété « Relation ».')}</p>
      )}
      <label className="menu-row">
        {t('Propriété')}
        <select
          aria-label={t('Propriété agrégée')}
          value={cfg.targetPropertyId ?? ''}
          disabled={!relation}
          onChange={(e) => onChange({ ...cfg, targetPropertyId: e.target.value || null })}
        >
          <option value="">{t('Choisir…')}</option>
          {targetProps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="menu-row">
        {t('Calcul')}
        <select
          aria-label={t('Calcul')}
          value={cfg.aggregate}
          onChange={(e) => onChange({ ...cfg, aggregate: e.target.value as RollupAggregate })}
        >
          {(Object.keys(ROLLUP_LABELS) as RollupAggregate[]).map((a) => (
            <option key={a} value={a}>
              {ROLLUP_LABELS[a]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
