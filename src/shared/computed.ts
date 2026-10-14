import {
  displayValue,
  isComputed,
  isComputedError,
  isEmpty,
  rowValue,
  type DatabaseRow,
  type DatabaseSchema,
  type DateValue,
  type PropertyDef,
  type PropertyValue
} from './database'
import { FormulaError, evaluate, parseFormula, toText, type FormulaValue } from './formula'

export interface DatabaseSource {
  schema: DatabaseSchema
  rows: DatabaseRow[]
}

/** Stored (not computed) schema and rows of a database, or null if it does not exist. */
export type DatabaseLookup = (databaseId: string) => DatabaseSource | null

/**
 * Fills in formula and rollup values for every row of a database. Values are
 * computed on read and never stored; rollups follow relations into other
 * databases. Circular references produce an error value instead of looping.
 */
export function computeDatabase(
  databaseId: string,
  source: DatabaseSource,
  lookup: DatabaseLookup,
  titleOf: (pageId: string) => string | undefined,
  now: () => Date = () => new Date()
): DatabaseRow[] {
  const computed = source.schema.properties.filter((p) => isComputed(p.type))
  if (computed.length === 0) return source.rows
  const engine = new Engine(lookup, titleOf, now)
  return source.rows.map((row) => {
    const properties = { ...row.properties }
    for (const prop of computed) {
      const v = engine.value(databaseId, source, row, prop)
      if (v === null) delete properties[prop.id]
      else properties[prop.id] = v
    }
    return { ...row, properties }
  })
}

type Parsed = ReturnType<typeof parseFormula>

class Engine {
  private readonly cache = new Map<string, PropertyValue>()
  private readonly running = new Set<string>()
  private readonly sources = new Map<string, DatabaseSource | null>()
  private readonly parsed = new Map<string, Parsed | FormulaError>()

  constructor(
    private readonly lookup: DatabaseLookup,
    private readonly titleOf: (pageId: string) => string | undefined,
    private readonly now: () => Date
  ) {}

  private source(id: string): DatabaseSource | null {
    if (!this.sources.has(id)) this.sources.set(id, this.lookup(id))
    return this.sources.get(id) ?? null
  }

  value(dbId: string, src: DatabaseSource, row: DatabaseRow, prop: PropertyDef): PropertyValue {
    const key = `${dbId}|${row.id}|${prop.id}`
    if (this.cache.has(key)) return this.cache.get(key)!
    if (this.running.has(key)) return { error: 'Référence circulaire' }
    this.running.add(key)
    let result: PropertyValue
    try {
      result =
        prop.type === 'formula' ? this.formula(dbId, src, row, prop) : this.rollup(src, row, prop)
    } catch (e) {
      result = { error: e instanceof FormulaError ? e.message : 'Erreur de calcul' }
    } finally {
      this.running.delete(key)
    }
    this.cache.set(key, result)
    return result
  }

  private formula(
    dbId: string,
    src: DatabaseSource,
    row: DatabaseRow,
    prop: PropertyDef
  ): PropertyValue {
    const expression = (prop.formula ?? '').trim()
    if (!expression) return null
    let tree = this.parsed.get(expression)
    if (!tree) {
      try {
        tree = parseFormula(expression)
      } catch (e) {
        tree = e instanceof FormulaError ? e : new FormulaError('Formule invalide.')
      }
      this.parsed.set(expression, tree)
    }
    if (tree instanceof FormulaError) throw tree
    const byName = (name: string): PropertyDef | undefined => {
      const wanted = name.trim().toLowerCase()
      return src.schema.properties.find((p) => p.name.trim().toLowerCase() === wanted)
    }
    const result = evaluate(tree, {
      now: this.now,
      prop: (name) => {
        const p = byName(name)
        if (!p) throw new FormulaError(`Propriété inconnue : « ${name} ».`)
        return this.input(dbId, src, row, p)
      }
    })
    return fromFormula(result)
  }

  /** A property value as seen by formulas. */
  private input(dbId: string, src: DatabaseSource, row: DatabaseRow, p: PropertyDef): FormulaValue {
    const v = isComputed(p.type) ? this.value(dbId, src, row, p) : rowValue(row, p)
    if (isComputedError(v)) throw new FormulaError(`${p.name} : ${v.error}`)
    switch (p.type) {
      case 'number':
        return typeof v === 'number' ? v : null
      case 'checkbox':
        return v === true
      case 'select':
        return typeof v === 'string' ? (p.options?.find((o) => o.id === v)?.name ?? null) : null
      case 'multi_select':
        return Array.isArray(v)
          ? v.map((id) => p.options?.find((o) => o.id === id)?.name ?? '').filter(Boolean)
          : []
      case 'relation':
        return Array.isArray(v) ? v.map((id) => this.titleOf(id) ?? '').filter(Boolean) : []
      case 'date':
      case 'created_time':
      case 'last_edited_time':
        return v && typeof v === 'object' && !Array.isArray(v) && 'start' in v
          ? toDate(v.start)
          : null
      case 'formula':
      case 'rollup':
        return toFormula(v)
      default:
        return typeof v === 'string' ? v : ''
    }
  }

  private rollup(src: DatabaseSource, row: DatabaseRow, prop: PropertyDef): PropertyValue {
    const cfg = prop.rollup
    const relation = src.schema.properties.find(
      (p) => p.id === cfg?.relationPropertyId && p.type === 'relation'
    )
    if (!cfg || !relation) return { error: 'Choisissez la relation à agréger' }
    const targetId = relation.relationDatabaseId
    const target = targetId ? this.source(targetId) : null
    if (!targetId || !target) return { error: 'Base liée introuvable' }
    const ids = row.properties[relation.id]
    const linked = (Array.isArray(ids) ? ids : [])
      .map((id) => target.rows.find((r) => r.id === id && !r.isTemplate))
      .filter((r): r is DatabaseRow => !!r)
    if (cfg.aggregate === 'count') return linked.length
    const targetProp = target.schema.properties.find((p) => p.id === cfg.targetPropertyId)
    if (!targetProp) return { error: 'Choisissez la propriété à agréger' }
    const values = linked.map((r) =>
      isComputed(targetProp.type)
        ? this.value(targetId, target, r, targetProp)
        : rowValue(r, targetProp)
    )
    const texts = values.map((v) => displayValue(targetProp, v, this.titleOf))
    const total = values.length
    const percent = (n: number): number => (total ? Math.round((n / total) * 1000) / 10 : 0)
    const numbers = values.filter((v): v is number => typeof v === 'number')
    const dates = values
      .filter(
        (v): v is DateValue => !!v && typeof v === 'object' && !Array.isArray(v) && 'start' in v
      )
      .map((d) => d.start)
      .sort()
    switch (cfg.aggregate) {
      case 'show_original':
        return texts.filter(Boolean)
      case 'count_values':
        return values.reduce<number>(
          (n, v) => n + (Array.isArray(v) ? v.length : isEmpty(v) ? 0 : 1),
          0
        )
      case 'count_unique':
        return new Set(texts.flatMap((t) => t.split(', ')).filter(Boolean)).size
      case 'count_empty':
        return values.filter((v) => isEmpty(v) && targetProp.type !== 'checkbox').length
      case 'percent_empty':
        return percent(values.filter((v) => isEmpty(v)).length)
      case 'percent_checked':
        return percent(values.filter((v) => v === true).length)
      case 'sum':
        return numbers.reduce((s, n) => s + n, 0)
      case 'average':
        return numbers.length ? numbers.reduce((s, n) => s + n, 0) / numbers.length : null
      case 'median': {
        if (!numbers.length) return null
        const sorted = [...numbers].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      }
      case 'min':
        return numbers.length ? Math.min(...numbers) : null
      case 'max':
        return numbers.length ? Math.max(...numbers) : null
      case 'range':
        return numbers.length ? Math.max(...numbers) - Math.min(...numbers) : null
      case 'earliest':
        return dates.length ? { start: dates[0] } : null
      case 'latest':
        return dates.length ? { start: dates[dates.length - 1] } : null
      default:
        return null
    }
  }
}

const toDate = (s: string): Date => new Date(s.length === 10 ? `${s}T00:00` : s)

const pad = (n: number): string => String(n).padStart(2, '0')

function fromFormula(v: FormulaValue): PropertyValue {
  if (v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : { error: 'Résultat non numérique' }
  if (typeof v === 'string' || typeof v === 'boolean') return v
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { error: 'Date invalide' }
    const day = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
    const time =
      v.getHours() || v.getMinutes() ? `T${pad(v.getHours())}:${pad(v.getMinutes())}` : ''
    return { start: day + time }
  }
  return v.map(toText)
}

function toFormula(v: PropertyValue): FormulaValue {
  if (v === null || isComputedError(v)) return null
  if (typeof v === 'object' && !Array.isArray(v)) return toDate(v.start)
  return v
}
