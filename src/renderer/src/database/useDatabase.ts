import { useCallback, useEffect, useState } from 'react'
import type { DatabaseData, NewRow, PageId } from '../../../shared/types'
import {
  isComputed,
  type DatabaseRow,
  type DatabaseSchema,
  type PropertyType,
  type PropertyValue
} from '../../../shared/database'
import { useStore } from '../store'

export interface DatabaseApi {
  data: DatabaseData | null
  reload: () => Promise<void>
  saveSchema: (schema: DatabaseSchema) => Promise<void>
  updateRow: (rowId: PageId, values: Record<string, PropertyValue>) => Promise<void>
  addRow: (init?: NewRow) => Promise<DatabaseRow | null>
  changeType: (propertyId: string, type: PropertyType) => Promise<void>
}

const fail = (e: unknown): void =>
  useStore
    .getState()
    .showNotice(`Modification impossible : ${e instanceof Error ? e.message : String(e)}`)

/** Loads a database and applies edits optimistically, then with the stored result. */
export function useDatabase(id: PageId): DatabaseApi {
  const [data, setData] = useState<DatabaseData | null>(null)

  const reload = useCallback(async () => {
    const next = await window.api.databases.get(id)
    setData(next)
  }, [id])

  useEffect(() => {
    let cancelled = false
    window.api.databases.get(id).then((next) => {
      if (!cancelled) setData(next)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  const saveSchema = async (schema: DatabaseSchema): Promise<void> => {
    setData((d) => (d ? { ...d, schema } : d))
    try {
      const saved = await window.api.databases.updateSchema(id, schema)
      setData((d) => (d ? { ...d, schema: saved } : d))
      // Formulas and rollups depend on the schema: their values are computed again.
      if (saved.properties.some((p) => isComputed(p.type))) await reload()
    } catch (e) {
      fail(e)
      await reload()
    }
  }

  const updateRow = async (rowId: PageId, values: Record<string, PropertyValue>): Promise<void> => {
    setData((d) =>
      d
        ? {
            ...d,
            rows: d.rows.map((r) => {
              if (r.id !== rowId) return r
              const properties = { ...r.properties }
              for (const [k, v] of Object.entries(values)) {
                if (k === 'title') continue
                if (v === null) delete properties[k]
                else properties[k] = v
              }
              return {
                ...r,
                title: typeof values.title === 'string' ? values.title : r.title,
                properties
              }
            })
          }
        : d
    )
    try {
      const row = await window.api.databases.updateRow(rowId, values)
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === rowId ? row : r)) } : d))
      if ('title' in values) void useStore.getState().load()
    } catch (e) {
      fail(e)
      await reload()
    }
  }

  const addRow = async (init: NewRow = {}): Promise<DatabaseRow | null> => {
    try {
      const row = await window.api.databases.createRow(id, init)
      setData((d) => (d ? { ...d, rows: [...d.rows, row] } : d))
      void useStore.getState().load()
      return row
    } catch (e) {
      fail(e)
      return null
    }
  }

  const changeType = async (propertyId: string, type: PropertyType): Promise<void> => {
    try {
      await window.api.databases.changePropertyType(id, propertyId, type)
    } catch (e) {
      fail(e)
    }
    await reload()
  }

  return { data, reload, saveSchema, updateRow, addRow, changeType }
}
