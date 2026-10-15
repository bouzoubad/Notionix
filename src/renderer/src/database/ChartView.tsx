import { type ChartAggregate, type ChartConfig, type ChartType } from '../../../shared/database'
import { AGGREGATE_LABELS, chartData, type Bucket } from './chartData'
import { type ViewProps } from './viewTypes'

const TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Barres',
  hbar: 'Barres horizontales',
  stacked: 'Barres empilées',
  line: 'Courbe',
  area: 'Aire',
  donut: 'Anneau',
  pie: 'Camembert',
  number: 'Nombre'
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toLocaleString('fr-FR')
const short = (l: string): string => (l.length > 10 ? `${l.slice(0, 9)}…` : l)

/** Bars, lines, areas, pies or a single number, grouped by a property. */
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
  const { buckets: data, stackLabels, stackColors } = chartData(rows, schema.properties, chart)
  const numbers = schema.properties.filter((p) => ['number', 'formula', 'rollup'].includes(p.type))
  const groupable = schema.properties.filter(
    (p) => !['formula', 'rollup', 'files'].includes(p.type)
  )

  return (
    <div className="chart-view">
      <div className="chart-settings">
        <select
          aria-label="Type de graphique"
          value={chart.type}
          onChange={(e) => set({ type: e.target.value as ChartType })}
        >
          {(Object.keys(TYPE_LABELS) as ChartType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {chart.type !== 'number' && (
          <label>
            Grouper par
            <select
              value={chart.groupBy ?? ''}
              onChange={(e) => set({ groupBy: e.target.value || null })}
            >
              <option value="">Rien (total)</option>
              {groupable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {chart.type === 'stacked' && (
          <label>
            Empiler par
            <select
              value={chart.stackBy ?? ''}
              onChange={(e) => set({ stackBy: e.target.value || null })}
            >
              <option value="">—</option>
              {groupable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
              set({ aggregate: aggregate as ChartAggregate, valueProperty: prop || null })
            }}
          >
            <option value="count">Nombre de lignes</option>
            {numbers.flatMap((p) =>
              (Object.keys(AGGREGATE_LABELS) as (keyof typeof AGGREGATE_LABELS)[]).map((a) => (
                <option key={`${a}${p.id}`} value={`${a}:${p.id}`}>
                  {AGGREGATE_LABELS[a]} de {p.name}
                </option>
              ))
            )}
          </select>
        </label>
        {(chart.type === 'line' || chart.type === 'area') && (
          <label className="chart-check">
            <input
              type="checkbox"
              checked={!!chart.cumulative}
              onChange={(e) => set({ cumulative: e.target.checked })}
            />
            Cumulé
          </label>
        )}
      </div>
      {data.length === 0 ? (
        <div className="view-empty">Aucune ligne à représenter.</div>
      ) : chart.type === 'number' ? (
        <div className="chart-number">
          <strong>{fmt(data.reduce((s, d) => s + d.value, 0))}</strong>
          <span>
            {chart.aggregate === 'count'
              ? 'lignes'
              : `${AGGREGATE_LABELS[chart.aggregate]} de ${
                  numbers.find((p) => p.id === chart.valueProperty)?.name ?? ''
                }`}
          </span>
        </div>
      ) : chart.type === 'donut' || chart.type === 'pie' ? (
        <Donut data={data} hole={chart.type === 'donut'} />
      ) : chart.type === 'hbar' ? (
        <HorizontalBars data={data} />
      ) : (
        <Columns
          data={data}
          type={chart.type}
          stackLabels={stackLabels}
          stackColors={stackColors}
        />
      )}
      {chart.type === 'stacked' && stackLabels.length > 1 && (
        <ul className="donut-legend chart-legend">
          {stackLabels.map((s, i) => (
            <li key={s}>
              <span className="legend-dot" style={{ background: stackColors[i] }} /> {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Vertical bars (stacked or not), line or area over the groups. */
function Columns({
  data,
  type,
  stackLabels,
  stackColors
}: {
  data: Bucket[]
  type: ChartType
  stackLabels: string[]
  stackColors: string[]
}): React.JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.value))
  const width = Math.max(320, data.length * 70)
  const y = (v: number): number => 220 - (v / max) * 190
  const x = (i: number): number => 74 + i * 70
  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')
  return (
    <svg className="chart-svg" viewBox={`0 0 ${width} 260`} role="img">
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line className="chart-grid" x1="40" x2={width} y1={y(max * t)} y2={y(max * t)} />
          <text className="chart-axis" x="34" y={y(max * t) + 4} textAnchor="end">
            {fmt(max * t)}
          </text>
        </g>
      ))}
      {type === 'area' && (
        <polygon
          className="chart-area"
          points={`${x(0)},220 ${points} ${x(data.length - 1)},220`}
        />
      )}
      {(type === 'line' || type === 'area') && <polyline className="chart-line" points={points} />}
      {data.map((d, i) => (
        <g key={d.label}>
          {type === 'bar' && (
            <rect
              x={x(i) - 22}
              y={y(d.value)}
              width="44"
              height={220 - y(d.value)}
              rx="4"
              fill={d.color}
            >
              <title>
                {d.label} : {fmt(d.value)}
              </title>
            </rect>
          )}
          {type === 'stacked' &&
            (d.parts ?? [d.value]).map((part, j, parts) => {
              const below = parts.slice(0, j).reduce((s, n) => s + n, 0)
              return (
                <rect
                  key={j}
                  x={x(i) - 22}
                  y={y(below + part)}
                  width="44"
                  height={y(below) - y(below + part)}
                  fill={stackColors[j] ?? d.color}
                >
                  <title>
                    {d.label} · {stackLabels[j] || d.label} : {fmt(part)}
                  </title>
                </rect>
              )
            })}
          {(type === 'line' || type === 'area') && (
            <circle cx={x(i)} cy={y(d.value)} r="4" className="chart-point">
              <title>
                {d.label} : {fmt(d.value)}
              </title>
            </circle>
          )}
          <text className="chart-value" x={x(i)} y={y(d.value) - 6} textAnchor="middle">
            {fmt(d.value)}
          </text>
          <text className="chart-label" x={x(i)} y="240" textAnchor="middle">
            {short(d.label)}
          </text>
        </g>
      ))}
    </svg>
  )
}

function HorizontalBars({ data }: { data: Bucket[] }): React.JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.value))
  const height = data.length * 32 + 10
  return (
    <svg className="chart-svg" viewBox={`0 0 520 ${height}`} role="img">
      {data.map((d, i) => {
        const w = (d.value / max) * 330
        return (
          <g key={d.label}>
            <text className="chart-label" x="110" y={i * 32 + 22} textAnchor="end">
              {d.label.length > 16 ? `${d.label.slice(0, 15)}…` : d.label}
            </text>
            <rect x="118" y={i * 32 + 6} width={Math.max(w, 1)} height="22" rx="4" fill={d.color}>
              <title>
                {d.label} : {fmt(d.value)}
              </title>
            </rect>
            <text className="chart-value" x={124 + w} y={i * 32 + 22}>
              {fmt(d.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Donut({ data, hole }: { data: Bucket[]; hole: boolean }): React.JSX.Element {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const inner = 55
  // Each slice starts where the previous ones end.
  const starts = data.map(
    (_, i) =>
      -Math.PI / 2 + (data.slice(0, i).reduce((s, d) => s + d.value, 0) / total) * Math.PI * 2
  )
  const p = (t: number, r: number): string => `${110 + r * Math.cos(t)} ${110 + r * Math.sin(t)}`
  const arcs = data.map((d, i) => {
    const a = (d.value / total) * Math.PI * 2
    const start = starts[i]
    const angle = start + a
    const large = a > Math.PI ? 1 : 0
    const ring = `M ${p(0, 90)} A 90 90 0 1 1 ${p(Math.PI, 90)} A 90 90 0 1 1 ${p(0, 90)}`
    const path =
      a >= Math.PI * 2 - 1e-6
        ? hole
          ? `${ring} M ${p(0, inner)} A ${inner} ${inner} 0 1 0 ${p(Math.PI, inner)} A ${inner} ${inner} 0 1 0 ${p(0, inner)}`
          : ring
        : hole
          ? `M ${p(start, 90)} A 90 90 0 ${large} 1 ${p(angle, 90)} L ${p(angle, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(start, inner)} Z`
          : `M 110 110 L ${p(start, 90)} A 90 90 0 ${large} 1 ${p(angle, 90)} Z`
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
        {hole && (
          <text x="110" y="116" textAnchor="middle" className="donut-total">
            {fmt(total)}
          </text>
        )}
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
