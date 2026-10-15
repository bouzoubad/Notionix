import {
  displayValue,
  isComputedError,
  rowValue,
  type ChartConfig,
  type DatabaseRow,
  type PropertyDef
} from '../../../shared/database'
import { nameOf, type ViewProps } from './viewTypes'

const PALETTE = ['blue', 'orange', 'green', 'purple', 'pink', 'yellow', 'red', 'brown', 'gray']

interface Bucket {
  label: string
  value: number
  color: string
}

/** Labels a row falls under for a property: options, people, a month, or its text. */
function labelsOf(prop: PropertyDef, row: DatabaseRow): string[] {
  const value = rowValue(row, prop)
  if (value === null || isComputedError(value)) return ['Vide']
  if (prop.type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time') {
    const start = (value as { start: string }).start
    const [y, m] = start.split('-').map(Number)
    return [new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })]
  }
  if (Array.isArray(value)) {
    const names = value.map((v) =>
      prop.type === 'multi_select'
        ? (prop.options?.find((o) => o.id === v)?.name ?? '')
        : (nameOf(v) ?? '')
    )
    return names.length ? names.filter(Boolean) : ['Vide']
  }
  return [displayValue(prop, value, nameOf) || 'Vide']
}

function buckets(rows: DatabaseRow[], props: PropertyDef[], chart: ChartConfig): Bucket[] {
  const group = props.find((p) => p.id === chart.groupBy)
  const measure = props.find((p) => p.id === chart.valueProperty)
  const sums = new Map<string, { total: number; count: number }>()
  for (const row of rows) {
    const n = measure ? rowValue(row, measure) : null
    for (const label of group ? labelsOf(group, row) : ['Total']) {
      const s = sums.get(label) ?? { total: 0, count: 0 }
      s.count += 1
      if (typeof n === 'number') s.total += n
      sums.set(label, s)
    }
  }
  // Options keep their order and colors.
  const options = group?.options ?? []
  const order = (l: string): number => {
    const i = options.findIndex((o) => o.name === l)
    return i < 0 ? options.length + (l === 'Vide' ? 1 : 0) : i
  }
  return [...sums.entries()]
    .sort(
      (a, b) =>
        order(a[0]) - order(b[0]) ||
        (chart.groupBy && group?.type === 'date' ? 0 : b[1].count - a[1].count)
    )
    .map(([label, s], i) => ({
      label,
      value:
        chart.aggregate === 'count' || !measure
          ? s.count
          : chart.aggregate === 'sum'
            ? s.total
            : s.count
              ? s.total / s.count
              : 0,
      color: `var(--nx-${options.find((o) => o.name === label)?.color ?? PALETTE[i % PALETTE.length]})`
    }))
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toLocaleString('fr-FR')

/** Bar, line or donut chart of the rows, grouped by a property. */
export function ChartView({ schema, view, rows, onSchema }: ViewProps): React.JSX.Element {
  const chart: ChartConfig = view.chart ?? {
    type: 'bar',
    groupBy: null,
    aggregate: 'count',
    valueProperty: null
  }
  const set = (next: Partial<ChartConfig>): void =>
    onSchema({
      ...schema,
      views: schema.views.map((v) =>
        v.id === view.id ? { ...v, chart: { ...chart, ...next } } : v
      )
    })
  const data = buckets(rows, schema.properties, chart)
  const max = Math.max(1, ...data.map((d) => d.value))
  const numbers = schema.properties.filter((p) => ['number', 'formula', 'rollup'].includes(p.type))

  return (
    <div className="chart-view">
      <div className="chart-settings">
        <select
          aria-label="Type de graphique"
          value={chart.type}
          onChange={(e) => set({ type: e.target.value as ChartConfig['type'] })}
        >
          <option value="bar">Barres</option>
          <option value="line">Courbe</option>
          <option value="donut">Anneau</option>
        </select>
        <label>
          Grouper par
          <select
            value={chart.groupBy ?? ''}
            onChange={(e) => set({ groupBy: e.target.value || null })}
          >
            <option value="">Rien (total)</option>
            {schema.properties
              .filter((p) => !['formula', 'rollup', 'files'].includes(p.type))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Valeur
          <select
            value={
              chart.aggregate === 'count'
                ? 'count'
                : `${chart.aggregate}:${chart.valueProperty ?? ''}`
            }
            onChange={(e) => {
              const [aggregate, prop] = e.target.value.split(':')
              set({ aggregate: aggregate as ChartConfig['aggregate'], valueProperty: prop || null })
            }}
          >
            <option value="count">Nombre de lignes</option>
            {numbers.flatMap((p) => [
              <option key={`s${p.id}`} value={`sum:${p.id}`}>
                Somme de {p.name}
              </option>,
              <option key={`a${p.id}`} value={`average:${p.id}`}>
                Moyenne de {p.name}
              </option>
            ])}
          </select>
        </label>
      </div>
      {data.length === 0 ? (
        <div className="view-empty">Aucune ligne à représenter.</div>
      ) : chart.type === 'donut' ? (
        <Donut data={data} />
      ) : (
        <svg
          className="chart-svg"
          viewBox={`0 0 ${Math.max(320, data.length * 70)} 260`}
          role="img"
        >
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line
                className="chart-grid"
                x1="40"
                x2={Math.max(320, data.length * 70)}
                y1={220 - t * 190}
                y2={220 - t * 190}
              />
              <text className="chart-axis" x="34" y={224 - t * 190} textAnchor="end">
                {fmt(max * t)}
              </text>
            </g>
          ))}
          {chart.type === 'bar' ? (
            data.map((d, i) => {
              const h = (d.value / max) * 190
              return (
                <g key={d.label}>
                  <rect x={52 + i * 70} y={220 - h} width="44" height={h} rx="4" fill={d.color}>
                    <title>
                      {d.label} : {fmt(d.value)}
                    </title>
                  </rect>
                  <text className="chart-value" x={74 + i * 70} y={214 - h} textAnchor="middle">
                    {fmt(d.value)}
                  </text>
                  <text className="chart-label" x={74 + i * 70} y="240" textAnchor="middle">
                    {d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label}
                  </text>
                </g>
              )
            })
          ) : (
            <>
              <polyline
                className="chart-line"
                points={data
                  .map((d, i) => `${74 + i * 70},${220 - (d.value / max) * 190}`)
                  .join(' ')}
              />
              {data.map((d, i) => (
                <g key={d.label}>
                  <circle
                    cx={74 + i * 70}
                    cy={220 - (d.value / max) * 190}
                    r="4"
                    className="chart-point"
                  />
                  <text className="chart-label" x={74 + i * 70} y="240" textAnchor="middle">
                    {d.label.length > 10 ? `${d.label.slice(0, 9)}…` : d.label}
                  </text>
                </g>
              ))}
            </>
          )}
        </svg>
      )}
    </div>
  )
}

function Donut({ data }: { data: Bucket[] }): React.JSX.Element {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  // Each slice starts where the previous ones end.
  const starts = data.map(
    (_, i) =>
      -Math.PI / 2 + (data.slice(0, i).reduce((s, d) => s + d.value, 0) / total) * Math.PI * 2
  )
  const arcs = data.map((d, i) => {
    const a = (d.value / total) * Math.PI * 2
    const start = starts[i]
    const angle = start + a
    const large = a > Math.PI ? 1 : 0
    const p = (t: number, r: number): string => `${110 + r * Math.cos(t)} ${110 + r * Math.sin(t)}`
    const path =
      a >= Math.PI * 2 - 1e-6
        ? `M ${p(0, 90)} A 90 90 0 1 1 ${p(Math.PI, 90)} A 90 90 0 1 1 ${p(0, 90)} M ${p(0, 55)} A 55 55 0 1 0 ${p(Math.PI, 55)} A 55 55 0 1 0 ${p(0, 55)}`
        : `M ${p(start, 90)} A 90 90 0 ${large} 1 ${p(angle, 90)} L ${p(angle, 55)} A 55 55 0 ${large} 0 ${p(start, 55)} Z`
    return { ...d, path }
  })
  return (
    <div className="donut">
      <svg viewBox="0 0 220 220" width="220" height="220" role="img">
        {arcs.map((a) => (
          <path key={a.label} d={a.path} fill={a.color} fillRule="evenodd">
            <title>
              {a.label} : {fmt(a.value)}
            </title>
          </path>
        ))}
        <text x="110" y="116" textAnchor="middle" className="donut-total">
          {fmt(total)}
        </text>
      </svg>
      <ul className="donut-legend">
        {data.map((d) => (
          <li key={d.label}>
            <span className="legend-dot" style={{ background: d.color }} /> {d.label}
            <span className="muted">
              {' '}
              {fmt(d.value)} ({Math.round((d.value / total) * 100)} %)
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
