import {
  displayValue,
  isComputedError,
  rowValue,
  type ChartAggregate,
  type ChartConfig,
  type DatabaseRow,
  type PropertyDef
} from '../../../shared/database'
import { nameOf } from './viewTypes'

const PALETTE = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow', 'red', 'brown', 'gray']

export const AGGREGATE_LABELS: Record<Exclude<ChartAggregate, 'count'>, string> = {
  sum: 'Somme',
  average: 'Moyenne',
  median: 'Médiane',
  min: 'Minimum',
  max: 'Maximum'
}

export interface Bucket {
  label: string
  value: number
  color: string
  /** Stacked bars: the parts of the bar, in the order of the stack labels */
  parts?: number[]
}

const isDateProp = (p: PropertyDef | undefined): boolean =>
  !!p && (p.type === 'date' || p.type === 'created_time' || p.type === 'last_edited_time')

/** Labels a row falls under: options, people, a month (with its sort key), or its text. */
function labelsOf(prop: PropertyDef, row: DatabaseRow): { label: string; key?: number }[] {
  const value = rowValue(row, prop)
  if (value === null || isComputedError(value)) return [{ label: 'Vide' }]
  if (isDateProp(prop)) {
    const [y, m] = (value as { start: string }).start.split('-').map(Number)
    return [
      {
        label: new Date(y, m - 1, 1).toLocaleDateString('fr-FR', {
          month: 'short',
          year: 'numeric'
        }),
        key: y * 12 + m
      }
    ]
  }
  if (Array.isArray(value)) {
    const names = value
      .map((v) =>
        prop.type === 'multi_select'
          ? (prop.options?.find((o) => o.id === v)?.name ?? '')
          : (nameOf(v) ?? '')
      )
      .filter(Boolean)
    return names.length ? names.map((label) => ({ label })) : [{ label: 'Vide' }]
  }
  return [{ label: displayValue(prop, value, nameOf) || 'Vide' }]
}

/** The aggregate of a bucket's numbers (its rows counted for 'count'). */
function aggregate(kind: ChartAggregate, count: number, numbers: number[]): number {
  if (kind === 'count') return count
  if (!numbers.length) return 0
  const sorted = [...numbers].sort((a, b) => a - b)
  switch (kind) {
    case 'sum':
      return sorted.reduce((s, n) => s + n, 0)
    case 'average':
      return sorted.reduce((s, n) => s + n, 0) / sorted.length
    case 'median': {
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
    case 'min':
      return sorted[0]
    case 'max':
      return sorted[sorted.length - 1]
  }
}

/** Position of a label among the property's options; others after, 'Vide' last. */
const optionOrder =
  (prop: PropertyDef | undefined) =>
  (l: string): number => {
    const options = prop?.options ?? []
    const i = options.findIndex((o) => o.name === l)
    return i < 0 ? options.length + (l === 'Vide' ? 1 : 0) : i
  }
const colorOf = (prop: PropertyDef | undefined, label: string, i: number): string =>
  `var(--nx-${prop?.options?.find((o) => o.name === label)?.color ?? PALETTE[i % PALETTE.length]})`

interface Acc {
  count: number
  numbers: number[]
}

/**
 * The buckets of a chart: rows grouped by a property (and split by another
 * for stacked bars), measured by count or an aggregate of a number property.
 * Dates are in time order; options in their order; the rest by size.
 */
export function chartData(
  rows: DatabaseRow[],
  props: PropertyDef[],
  chart: ChartConfig
): { buckets: Bucket[]; stackLabels: string[]; stackColors: string[] } {
  const group = chart.type === 'number' ? undefined : props.find((p) => p.id === chart.groupBy)
  const stack = chart.type === 'stacked' ? props.find((p) => p.id === chart.stackBy) : undefined
  const measure = props.find((p) => p.id === chart.valueProperty)
  const kind: ChartAggregate = measure ? chart.aggregate : 'count'
  const cells = new Map<string, Map<string, Acc>>()
  const keys = new Map<string, number>()
  const stackSeen = new Set<string>()
  for (const row of rows) {
    const n = measure ? rowValue(row, measure) : null
    for (const { label, key } of group ? labelsOf(group, row) : [{ label: 'Total' }]) {
      if (key !== undefined) keys.set(label, key)
      for (const { label: part } of stack ? labelsOf(stack, row) : [{ label: '' }]) {
        stackSeen.add(part)
        const byPart = cells.get(label) ?? new Map<string, Acc>()
        const acc = byPart.get(part) ?? { count: 0, numbers: [] }
        acc.count += 1
        if (typeof n === 'number') acc.numbers.push(n)
        byPart.set(part, acc)
        cells.set(label, byPart)
      }
    }
  }
  const total = (m: Map<string, Acc>): Acc => {
    const all: Acc = { count: 0, numbers: [] }
    for (const a of m.values()) {
      all.count += a.count
      all.numbers.push(...a.numbers)
    }
    return all
  }
  const stackOrder = optionOrder(stack)
  const stackLabels = [...stackSeen].sort((a, b) => stackOrder(a) - stackOrder(b))
  const order = optionOrder(group)
  const byKey = (l: string): number => keys.get(l) ?? Number.MAX_SAFE_INTEGER
  const buckets: Bucket[] = [...cells.entries()]
    .sort((a, b) =>
      isDateProp(group)
        ? byKey(a[0]) - byKey(b[0])
        : order(a[0]) - order(b[0]) || total(b[1]).count - total(a[1]).count
    )
    .map(([label, byPart], i) => {
      const all = total(byPart)
      const parts = stack
        ? stackLabels.map((s) => {
            const acc = byPart.get(s)
            return acc ? aggregate(kind, acc.count, acc.numbers) : 0
          })
        : undefined
      // Stacked counts and sums add up to the bar; other measures keep their own total.
      const additive = kind === 'count' || kind === 'sum'
      return {
        label,
        value:
          parts && additive
            ? parts.reduce((s, n) => s + n, 0)
            : aggregate(kind, all.count, all.numbers),
        color: colorOf(group, label, i),
        ...(parts ? { parts } : {})
      }
    })
  if (chart.cumulative && (chart.type === 'line' || chart.type === 'area')) {
    let running = 0
    for (const b of buckets) b.value = running += b.value
  }
  return { buckets, stackLabels, stackColors: stackLabels.map((s, i) => colorOf(stack, s, i)) }
}
