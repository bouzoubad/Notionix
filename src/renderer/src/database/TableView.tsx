import { Fragment, useRef, useState } from 'react'
import {
  CALC_LABELS,
  PROPERTY_TYPE_LABELS,
  TITLE_PROPERTY_ID,
  calculate,
  calculationsFor,
  defaultStatusOptions,
  groupRows,
  newId,
  type CalcKind,
  type DatabaseRow,
  type PropertyDef,
  type PropertyType,
  type PropertyValue,
  type RowGroup,
  type ViewDef
} from '../../../shared/database'
import { Cell } from './Cell'
import {
  TYPE_ICONS,
  canReorder,
  groupProperty,
  groupValues,
  nameOf,
  subGroupProperty,
  visibleProperties,
  type ViewProps
} from './viewTypes'
import { OptionTag } from './OptionTag'
import { useRowDrag } from './rowDrag'
import { Popover } from './Popover'
import { PropertyMenu } from './PropertyMenu'
import { t } from '../../../shared/i18n'

const DEFAULT_WIDTH = 180
const TITLE_WIDTH = 260

export function TableView(props: ViewProps): React.JSX.Element {
  const { schema, view, rows } = props
  const [menu, setMenu] = useState<string | null>(null)
  const [calcMenu, setCalcMenu] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const columns = visibleProperties(schema, view)
  const reorder = canReorder(view)
  const drag = useRowDrag(reorder, props.onMoveRow)
  const groupProp = groupProperty(schema, view)
  const subProp = groupProp ? subGroupProperty(schema, view) : undefined
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string): void =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const patchView = (next: Partial<ViewDef>): void =>
    props.onSchema({
      ...schema,
      views: schema.views.map((v) => (v.id === view.id ? { ...v, ...next } : v))
    })

  // Column widths: dragged live, saved in the view on release.
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({})
  const resizing = useRef<{ id: string; startX: number; start: number } | null>(null)
  const widthOf = (p: PropertyDef): number =>
    liveWidths[p.id] ??
    view.widths?.[p.id] ??
    (p.id === TITLE_PROPERTY_ID ? TITLE_WIDTH : DEFAULT_WIDTH)
  const startResize = (e: React.PointerEvent, p: PropertyDef): void => {
    e.preventDefault()
    e.stopPropagation()
    resizing.current = { id: p.id, startX: e.clientX, start: widthOf(p) }
    const move = (ev: PointerEvent): void => {
      const r = resizing.current
      if (!r) return
      setLiveWidths({ [r.id]: Math.min(800, Math.max(60, r.start + ev.clientX - r.startX)) })
    }
    const up = (ev: PointerEvent): void => {
      const r = resizing.current
      resizing.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLiveWidths({})
      if (r)
        patchView({
          widths: {
            ...view.widths,
            [r.id]: Math.min(800, Math.max(60, Math.round(r.start + ev.clientX - r.startX)))
          }
        })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Sub-items: rows nest under their parent (when the view is not grouped).
  const nesting = groupProp ? null : (schema.subItems ?? null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const childrenOf = (id: string): string[] => {
    const v = nesting ? rows.find((r) => r.id === id)?.properties[nesting.childrenPropertyId] : null
    return Array.isArray(v) ? v : []
  }
  const nested = (list: DatabaseRow[]): { row: DatabaseRow; depth: number }[] => {
    if (!nesting) return list.map((row) => ({ row, depth: 0 }))
    const shown = new Map(list.map((r) => [r.id, r]))
    const parentOf = (r: DatabaseRow): string | null => {
      const v = r.properties[nesting.parentPropertyId]
      return Array.isArray(v) && v[0] && shown.has(v[0]) ? v[0] : null
    }
    const out: { row: DatabaseRow; depth: number }[] = []
    const seen = new Set<string>()
    const visit = (r: DatabaseRow, depth: number): void => {
      if (seen.has(r.id)) return
      seen.add(r.id)
      out.push({ row: r, depth })
      if (folded.has(r.id)) return
      for (const child of list) if (parentOf(child) === r.id) visit(child, depth + 1)
    }
    for (const r of list) if (!parentOf(r)) visit(r, 0)
    return out
  }

  const cell = (p: PropertyDef, row: DatabaseRow): React.JSX.Element => (
    <Cell
      prop={p}
      row={row}
      onChange={(value) =>
        props.onUpdateRow(row.id, p.id === TITLE_PROPERTY_ID ? { title: value } : { [p.id]: value })
      }
      onCreateOption={props.onCreateOption}
    />
  )

  const rowsOf = (
    list: DatabaseRow[],
    values?: Record<string, PropertyValue>
  ): React.JSX.Element[] =>
    nested(list).map(({ row, depth }) => (
      <tr
        key={row.id}
        data-row-id={row.id}
        className={drag.dropClass(row.id)}
        {...drag.target(row, list, values)}
      >
        <td className="drag-col">
          {reorder && (
            <span className="row-drag" title={t('Glisser pour déplacer')} {...drag.handle(row.id)}>
              ⋮⋮
            </span>
          )}
        </td>
        {columns.map((p) => (
          <td key={p.id} className={p.id === TITLE_PROPERTY_ID ? 'title-col' : ''}>
            {p.id === TITLE_PROPERTY_ID && (
              <button className="open-row" onClick={() => props.onOpenRow(row.id)}>
                {t('Ouvrir')}
              </button>
            )}
            {p.id === TITLE_PROPERTY_ID && nesting ? (
              // Sub-items: the title moves right with the depth, after the fold button.
              <div className="sub-row" style={{ paddingLeft: depth * 18 }}>
                <span className="sub-indent">
                  {childrenOf(row.id).length > 0 && (
                    <button
                      className="sub-toggle"
                      aria-expanded={!folded.has(row.id)}
                      onClick={() =>
                        setFolded((f) => {
                          const next = new Set(f)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })
                      }
                    >
                      {folded.has(row.id) ? '▸' : '▾'}
                    </button>
                  )}
                </span>
                {cell(p, row)}
              </div>
            ) : (
              cell(p, row)
            )}
          </td>
        ))}
        <td />
      </tr>
    ))

  /** A group header, then its rows (or its sub-groups). */
  const groupBlock = (
    g: RowGroup,
    prop: PropertyDef,
    key: string,
    depth: number,
    parentValues?: Record<string, PropertyValue>
  ): React.JSX.Element => {
    const values = { ...parentValues, ...groupValues(prop, g) }
    const hasValues = Object.keys(values).length > 0 ? values : undefined
    return (
      <Fragment key={key}>
        <tr className={`group-row depth-${depth}`} {...drag.end(hasValues)}>
          <td colSpan={columns.length + 2} style={{ paddingLeft: 8 + depth * 22 }}>
            <button
              className="group-toggle"
              aria-expanded={!collapsed.has(key)}
              onClick={() => toggleGroup(key)}
            >
              {collapsed.has(key) ? '▸' : '▾'}
            </button>
            {g.option ? (
              <OptionTag option={g.option} />
            ) : (
              <span className="group-label">{g.label}</span>
            )}
            <span className="muted">{g.rows.length}</span>
            <button className="group-add" onClick={() => props.onAddRow(hasValues)}>
              +
            </button>
          </td>
        </tr>
        {!collapsed.has(key) &&
          (subProp && depth === 0
            ? groupRows(g.rows, subProp, nameOf)
                .filter((sg) => sg.rows.length > 0)
                .map((sg) => groupBlock(sg, subProp, `${key}/${sg.key ?? 'none'}`, 1, hasValues))
            : rowsOf(g.rows, hasValues))}
      </Fragment>
    )
  }

  const addProperty = (type: PropertyType): void => {
    setAdding(false)
    const prop: PropertyDef = { id: newId(), name: PROPERTY_TYPE_LABELS[type], type }
    if (type === 'select' || type === 'multi_select') prop.options = []
    if (type === 'status') prop.options = defaultStatusOptions()
    if (type === 'relation') prop.relationDatabaseId = null
    props.onSchema({ ...schema, properties: [...schema.properties, prop] })
    setMenu(prop.id)
  }

  const calcs = view.calculations ?? {}
  const shownRows = rows.filter((r) => !r.isTemplate)
  const totalWidth = 32 + columns.reduce((s, p) => s + widthOf(p), 0) + 48
  const classes = ['db-table', view.wrap ? 'wrap' : '', view.freezeTitle ? 'freeze' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className="table-view">
      <table className={classes} style={{ width: totalWidth, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 32 }} />
          {columns.map((p) => (
            <col key={p.id} style={{ width: widthOf(p) }} />
          ))}
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="drag-col" aria-hidden />
            {columns.map((p) => (
              <th key={p.id} className={p.id === TITLE_PROPERTY_ID ? 'title-col' : ''}>
                <button className="col-head" disabled={props.locked} onClick={() => setMenu(p.id)}>
                  <span className="type-icon">{TYPE_ICONS[p.type]}</span> {p.name}
                </button>
                {!props.locked && (
                  <span
                    className="col-resize"
                    title={t('Glisser pour changer la largeur')}
                    onPointerDown={(e) => startResize(e, p)}
                  />
                )}
                {menu === p.id && (
                  <PropertyMenu
                    prop={p}
                    schema={schema}
                    view={view}
                    databaseId={props.databaseId}
                    onSchema={props.onSchema}
                    onChangeType={(type) => props.onChangeType(p.id, type)}
                    onClose={() => setMenu(null)}
                  />
                )}
              </th>
            ))}
            <th className="add-col">
              {!props.locked && (
                <button aria-label={t('Ajouter une propriété')} onClick={() => setAdding(true)}>
                  +
                </button>
              )}
              {adding && (
                <Popover onClose={() => setAdding(false)} align="right">
                  <div className="menu-label">{t('Nouvelle propriété')}</div>
                  {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[])
                    .filter((type) => type !== 'title')
                    .map((type) => (
                      <button key={type} className="menu-item" onClick={() => addProperty(type)}>
                        <span className="type-icon">{TYPE_ICONS[type]}</span>{' '}
                        {PROPERTY_TYPE_LABELS[type]}
                      </button>
                    ))}
                </Popover>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {groupProp
            ? groupRows(rows, groupProp, nameOf).map((g) =>
                groupBlock(g, groupProp, g.key ?? 'none', 0)
              )
            : rowsOf(rows)}
        </tbody>
        <tfoot>
          <tr className="calc-row">
            <td className="drag-col" />
            {columns.map((p) => {
              const kind = calcs[p.id]
              return (
                <td key={p.id} className={p.id === TITLE_PROPERTY_ID ? 'title-col' : ''}>
                  <button
                    className={`calc-cell${kind ? ' set' : ''}`}
                    disabled={props.locked}
                    onClick={() => setCalcMenu(p.id)}
                  >
                    {kind ? (
                      <>
                        <span className="calc-label">{CALC_LABELS[kind]}</span>{' '}
                        {calculate(shownRows, p, kind, nameOf)}
                      </>
                    ) : (
                      <span className="calc-label">{t('Calculer')}</span>
                    )}
                  </button>
                  {calcMenu === p.id && (
                    <Popover onClose={() => setCalcMenu(null)}>
                      <button
                        className="menu-item"
                        onClick={() => {
                          const next = { ...calcs }
                          delete next[p.id]
                          patchView({ calculations: next })
                          setCalcMenu(null)
                        }}
                      >
                        {t('Aucun calcul')}
                      </button>
                      {calculationsFor(p.type).map((k: CalcKind) => (
                        <button
                          key={k}
                          className={`menu-item${kind === k ? ' active' : ''}`}
                          onClick={() => {
                            patchView({ calculations: { ...calcs, [p.id]: k } })
                            setCalcMenu(null)
                          }}
                        >
                          {CALC_LABELS[k]}
                        </button>
                      ))}
                    </Popover>
                  )}
                </td>
              )
            })}
            <td />
          </tr>
        </tfoot>
      </table>
      <button className="add-row" onClick={() => props.onAddRow()} {...drag.end()}>
        {t('+ Nouvelle ligne')}
      </button>
      {!reorder && rows.length > 1 && (
        <p className="hint">{t('Retirez le tri pour réordonner les lignes à la main.')}</p>
      )}
      <div className="db-count">{t('{n} ligne(s)', { n: rows.length })}</div>
    </div>
  )
}
