import { useState } from 'react'
import type { DatabaseRow, PropertyValue } from '../../../shared/database'

export type MoveRow = (
  rowId: string,
  beforeRowId: string | null,
  values?: Record<string, PropertyValue>
) => void

interface Over {
  id: string | null
  before: boolean
}

/**
 * Drag and drop of rows inside a view. Dropping on a row places the dragged
 * row before or after it (by pointer position); `values` are applied when the
 * target belongs to another group (e.g. another status).
 */
export interface RowDrag {
  dragging: string | null
  handle: (rowId: string) => React.HTMLAttributes<HTMLElement> & { draggable: boolean }
  target: (
    row: DatabaseRow,
    list: DatabaseRow[],
    values?: Record<string, PropertyValue>
  ) => React.HTMLAttributes<HTMLElement>
  end: (values?: Record<string, PropertyValue>) => React.HTMLAttributes<HTMLElement>
  dropClass: (rowId: string) => string
}

export function useRowDrag(enabled: boolean, onMove: MoveRow): RowDrag {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<Over | null>(null)
  const reset = (): void => {
    setDragging(null)
    setOver(null)
  }

  const handle = (rowId: string): React.HTMLAttributes<HTMLElement> & { draggable: boolean } => ({
    draggable: enabled,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', rowId)
      setDragging(rowId)
    },
    onDragEnd: reset
  })

  const target = (
    row: DatabaseRow,
    list: DatabaseRow[],
    values?: Record<string, PropertyValue>
  ): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: (e) => {
      if (!dragging) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      const before = e.clientY < r.top + r.height / 2
      if (over?.id !== row.id || over.before !== before) setOver({ id: row.id, before })
    },
    onDrop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (dragging && dragging !== row.id) {
        const r = e.currentTarget.getBoundingClientRect()
        const before = e.clientY < r.top + r.height / 2
        const rest = list.filter((x) => x.id !== dragging)
        const i = rest.findIndex((x) => x.id === row.id)
        const beforeId = before ? row.id : (rest[i + 1]?.id ?? null)
        onMove(dragging, beforeId, values)
      }
      reset()
    }
  })

  /** Drop zone after the last row of a group (or of the view). */
  const end = (values?: Record<string, PropertyValue>): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: (e) => {
      if (!dragging) return
      e.preventDefault()
      if (over?.id !== null) setOver({ id: null, before: false })
    },
    onDrop: (e) => {
      e.preventDefault()
      if (dragging) onMove(dragging, null, values)
      reset()
    }
  })

  const dropClass = (rowId: string): string =>
    over && dragging && over.id === rowId && dragging !== rowId
      ? over.before
        ? 'drop-before'
        : 'drop-after'
      : ''

  return { dragging, handle, target, end, dropClass }
}
