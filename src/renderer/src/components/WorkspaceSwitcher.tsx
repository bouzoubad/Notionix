import { useEffect, useState } from 'react'
import type { WorkspaceInfo } from '../../../shared/collab'
import type { ServerSession } from '../platform'
import { Popover } from '../database/Popover'

/** The workspace open now, and the others this person can switch to. */
export function WorkspaceSwitcher({
  workspaces
}: {
  workspaces: ServerSession['workspaces']
}): React.JSX.Element | null {
  const [list, setList] = useState<WorkspaceInfo[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    workspaces
      .list()
      .then((l) => !cancelled && setList(l))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspaces])
  // With a single workspace there is nothing to choose.
  if (list.length < 2) return null
  const current = list.find((w) => w.id === workspaces.current)
  return (
    <div className="workspace-switcher">
      <button className="workspace-current" onClick={() => setOpen(!open)}>
        <span className="workspace-icon">{current?.icon || '🏢'}</span>
        <span className="workspace-name">{current?.name ?? 'Espace'}</span>
        <span className="workspace-caret">▾</span>
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="workspace-menu">
          <div className="menu-label">Espaces de travail</div>
          {list.map((w) => (
            <button
              key={w.id}
              className={w.id === workspaces.current ? 'menu-item active' : 'menu-item'}
              onClick={() => {
                setOpen(false)
                if (w.id !== workspaces.current) workspaces.switchTo(w.id)
              }}
            >
              <span className="workspace-icon">{w.icon || '🏢'}</span> {w.name}
              {w.id === workspaces.current && <span className="workspace-check">✓</span>}
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}
