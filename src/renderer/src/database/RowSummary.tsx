import {
  displayValue,
  isEmpty,
  rowValue,
  type DatabaseRow,
  type DatabaseSchema,
  type ViewDef
} from '../../../shared/database'
import { useStore } from '../store'
import { OptionTag } from './OptionTag'

/** Compact, read-only view of a row's visible, non-empty properties (cards, list items). */
export function RowSummary({
  schema,
  view,
  row,
  skip = []
}: {
  schema: DatabaseSchema
  view: ViewDef
  row: DatabaseRow
  skip?: string[]
}): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const titleOf = (id: string): string | undefined =>
    pages.find((p) => p.id === id && !p.trashedAt)?.title
  const props = schema.properties.filter(
    (p) => p.type !== 'title' && !view.hidden.includes(p.id) && !skip.includes(p.id)
  )
  return (
    <span className="row-summary">
      {props.map((p) => {
        const value = rowValue(row, p)
        if (isEmpty(value)) return null
        if (p.type === 'select' || p.type === 'multi_select') {
          const ids = Array.isArray(value) ? value : [value as string]
          return ids.map((id) => {
            const option = p.options?.find((o) => o.id === id)
            return option ? <OptionTag key={`${p.id}-${id}`} option={option} /> : null
          })
        }
        const text = p.type === 'checkbox' ? `☑ ${p.name}` : displayValue(p, value, titleOf)
        return text ? (
          <span key={p.id} className="summary-value" title={p.name}>
            {text}
          </span>
        ) : null
      })}
    </span>
  )
}
