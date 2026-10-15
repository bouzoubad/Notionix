import { useEffect, useState } from 'react'
import {
  TITLE_PROPERTY_ID,
  type PropertyDef,
  type PropertyValue,
  type SelectOption
} from '../../../shared/database'
import type { RowData } from '../../../shared/types'
import { useStore } from '../store'
import { Cell } from './Cell'
import { TYPE_ICONS } from './viewTypes'
import { t } from '../../../shared/i18n'

/** Properties of a database row, shown under the title of its page. */
export function RowProperties({ rowId }: { rowId: string }): React.JSX.Element | null {
  const [data, setData] = useState<RowData | null>(null)
  const showNotice = useStore((s) => s.showNotice)
  const revision = useStore((s) => s.revision)

  useEffect(() => {
    let cancelled = false
    window.api.databases.getRow(rowId).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [rowId, revision])

  if (!data) return null
  const update = async (values: Record<string, PropertyValue>): Promise<void> => {
    try {
      const row = await window.api.databases.updateRow(rowId, values)
      setData((d) => (d ? { ...d, row } : d))
    } catch (e) {
      showNotice(
        t('Modification impossible : {error}', {
          error: e instanceof Error ? e.message : String(e)
        })
      )
    }
  }
  const createOption = async (prop: PropertyDef, option: SelectOption): Promise<void> => {
    const schema = await window.api.databases.updateSchema(data.databaseId, {
      ...data.schema,
      properties: data.schema.properties.map((p) =>
        p.id === prop.id ? { ...p, options: [...(p.options ?? []), option] } : p
      )
    })
    setData((d) => (d ? { ...d, schema } : d))
  }
  const toggleTemplate = async (flag: boolean): Promise<void> => {
    await window.api.databases.setTemplate(rowId, flag)
    setData((d) => (d ? { ...d, row: { ...d.row, isTemplate: flag } } : d))
  }

  return (
    <div className="row-properties">
      {data.schema.properties
        .filter((p) => p.id !== TITLE_PROPERTY_ID)
        .map((p) => (
          <div key={p.id} className="row-property">
            <span className="row-property-name">
              <span className="type-icon">{TYPE_ICONS[p.type]}</span> {p.name}
            </span>
            <Cell
              prop={p}
              row={data.row}
              onChange={(value) => void update({ [p.id]: value })}
              onCreateOption={createOption}
            />
          </div>
        ))}
      <label className="row-template">
        <input
          type="checkbox"
          checked={data.row.isTemplate}
          onChange={(e) => void toggleTemplate(e.target.checked)}
        />
        {t('Modèle (masqué des vues, proposé dans « Nouveau »)')}
      </label>
    </div>
  )
}
