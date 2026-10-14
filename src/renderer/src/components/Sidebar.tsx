import { useState } from 'react'
import { childrenOf, useStore } from '../store'
import type { PageSummary } from '../../../shared/types'

type DropTarget = { id: string; where: 'before' | 'inside' | 'after' } | null

export function Sidebar(): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const createPage = useStore((s) => s.createPage)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const setTrashOpen = useStore((s) => s.setTrashOpen)
  const [drag, setDrag] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget>(null)
  const move = useStore((s) => s.move)

  const favorites = pages.filter((p) => p.favorite && !p.trashedAt)
  const roots = childrenOf(pages, null)

  const dropOn = (target: PageSummary, where: 'before' | 'inside' | 'after'): void => {
    if (!drag || drag === target.id) return
    if (where === 'inside') {
      void move(drag, target.id, childrenOf(pages, target.id).length)
    } else {
      const sibs = childrenOf(pages, target.parentId).filter((p) => p.id !== drag)
      const i = sibs.findIndex((p) => p.id === target.id)
      void move(drag, target.parentId, where === 'before' ? i : i + 1)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-actions">
        <button onClick={() => setSearchOpen(true)}>
          Rechercher <kbd>⌘K</kbd>
        </button>
        <button onClick={() => void createPage(null)}>+ Nouvelle page</button>
      </div>
      {favorites.length > 0 && (
        <section>
          <h4>Favoris</h4>
          {favorites.map((p) => (
            <Row
              key={p.id}
              page={p}
              depth={0}
              flat
              drag={drag}
              setDrag={setDrag}
              drop={drop}
              setDrop={setDrop}
              dropOn={dropOn}
            />
          ))}
        </section>
      )}
      <section className="tree">
        <h4>Pages</h4>
        {roots.map((p) => (
          <Row
            key={p.id}
            page={p}
            depth={0}
            drag={drag}
            setDrag={setDrag}
            drop={drop}
            setDrop={setDrop}
            dropOn={dropOn}
          />
        ))}
        {roots.length === 0 && <p className="empty">Aucune page. Créez-en une.</p>}
      </section>
      <button className="trash-btn" onClick={() => setTrashOpen(true)}>
        Corbeille
      </button>
    </aside>
  )
}

interface RowProps {
  page: PageSummary
  depth: number
  flat?: boolean
  drag: string | null
  setDrag: (id: string | null) => void
  drop: DropTarget
  setDrop: (t: DropTarget) => void
  dropOn: (target: PageSummary, where: 'before' | 'inside' | 'after') => void
}

function Row(props: RowProps): React.JSX.Element {
  const { page, depth, flat, drag, setDrag, drop, setDrop, dropOn } = props
  const pages = useStore((s) => s.pages)
  const currentId = useStore((s) => s.currentId)
  const expanded = useStore((s) => s.expanded[page.id])
  const open = useStore((s) => s.open)
  const toggle = useStore((s) => s.toggle)
  const createPage = useStore((s) => s.createPage)
  const patch = useStore((s) => s.patch)
  const trash = useStore((s) => s.trash)
  const duplicate = useStore((s) => s.duplicate)
  const [menu, setMenu] = useState(false)
  const kids = flat ? [] : childrenOf(pages, page.id)

  const where = (e: React.DragEvent<HTMLDivElement>): 'before' | 'inside' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
  }
  const cls = [
    'row',
    currentId === page.id ? 'active' : '',
    drop?.id === page.id ? `drop-${drop.where}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <div
        className={cls}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!flat}
        onDragStart={() => setDrag(page.id)}
        onDragEnd={() => (setDrag(null), setDrop(null))}
        onDragOver={(e) => {
          if (!drag || flat || drag === page.id) return
          e.preventDefault()
          setDrop({ id: page.id, where: where(e) })
        }}
        onDrop={(e) => {
          e.preventDefault()
          dropOn(page, where(e))
          setDrag(null)
          setDrop(null)
        }}
        onClick={() => open(page.id)}
      >
        {!flat && (
          <button
            className="chevron"
            onClick={(e) => (e.stopPropagation(), toggle(page.id))}
            style={{ visibility: kids.length ? 'visible' : 'hidden' }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
        <span className="icon">{page.icon ?? '📄'}</span>
        <span className="label">{page.title || 'Sans titre'}</span>
        {!flat && (
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button title="Plus" onClick={() => setMenu(!menu)}>
              ⋯
            </button>
            <button title="Sous-page" onClick={() => void createPage(page.id)}>
              +
            </button>
          </span>
        )}
        {menu && (
          <div
            className="menu"
            onMouseLeave={() => setMenu(false)}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => (setMenu(false), void patch(page.id, { favorite: !page.favorite }))}
            >
              {page.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            </button>
            <button onClick={() => (setMenu(false), void duplicate(page.id))}>Dupliquer</button>
            <button onClick={() => (setMenu(false), void trash(page.id))}>
              Mettre à la corbeille
            </button>
          </div>
        )}
      </div>
      {!flat &&
        expanded &&
        kids.map((k) => <Row key={k.id} {...props} page={k} depth={depth + 1} />)}
    </div>
  )
}
