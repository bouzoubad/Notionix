import { useState } from 'react'
import { childrenOf, useStore } from '../store'
import { Logo } from './Logo'
import { platform } from '../platform'
import { Avatars } from './PageTopBar'
import type { PageSummary } from '../../../shared/types'

type DropTarget = { id: string; where: 'before' | 'inside' | 'after' } | null

export function Sidebar(): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const createPage = useStore((s) => s.createPage)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const setTrashOpen = useStore((s) => s.setTrashOpen)
  const setTransferOpen = useStore((s) => s.setTransferOpen)
  const createDatabase = useStore((s) => s.createDatabase)
  const session = platform().session
  const [drag, setDrag] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget>(null)
  const move = useStore((s) => s.move)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const unread = useStore((s) => s.inboxUnread)
  const setInboxOpen = useStore((s) => s.setInboxOpen)

  const favorites = pages.filter((p) => p.favorite && !p.trashedAt)
  const open = useStore((s) => s.open)
  const web = session !== null
  const me = session?.user.id ?? null
  const canCreate = !session || (session.user.role !== 'guest' && session.user.role !== 'reader')
  // Sections: teamspaces, the workspace, private pages, and pages shared on their own.
  const roots = childrenOf(pages, null)
  const spaces = roots.filter((p) => p.isSpace && p.parentId === null)
  const isPrivate = (p: PageSummary): boolean =>
    p.parentId === null && p.access === 'restricted' && p.createdBy === me
  const isShared = (p: PageSummary): boolean =>
    p.parentId !== null || (p.access === 'restricted' && p.createdBy !== me)
  const others = roots.filter((p) => !(p.isSpace && p.parentId === null))
  const mine = web ? others.filter(isPrivate) : []
  const shared = web ? others.filter((p) => !isPrivate(p) && isShared(p)) : []
  const team = others.filter((p) => !mine.includes(p) && !shared.includes(p))

  const dropOn = (target: PageSummary, where: 'before' | 'inside' | 'after'): void => {
    if (!drag || drag === target.id) return
    if (where === 'inside' && target.kind === 'database') return // rows are added from the database
    if (where === 'inside') {
      void move(drag, target.id, childrenOf(pages, target.id).length)
    } else {
      const sibs = childrenOf(pages, target.parentId).filter((p) => p.id !== drag)
      const i = sibs.findIndex((p) => p.id === target.id)
      void move(drag, target.parentId, where === 'before' ? i : i + 1)
    }
  }
  const rowProps = { drag, setDrag, drop, setDrop, dropOn }

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-brand">
        <Logo variant="wordmark" className="logo-sidebar" />
      </div>
      <div className="sidebar-actions">
        <button onClick={() => setSearchOpen(true)}>
          Rechercher <kbd>⌘K</kbd>
        </button>
        <button onClick={() => setInboxOpen(true)}>
          Boîte de réception
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        {canCreate && <button onClick={() => void createPage(null)}>+ Nouvelle page</button>}
        {canCreate && (
          <button onClick={() => void createDatabase(null)}>+ Nouvelle base de données</button>
        )}
      </div>
      <div className="sidebar-sections">
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
        {spaces.map((space) => (
          <TreeSection
            key={space.id}
            title={`${space.icon ?? '👥'} ${space.title || 'Espace sans titre'}`}
            onTitle={() => open(space.id)}
            onAdd={space.level !== 'read' ? () => void createPage(space.id) : undefined}
            pages={childrenOf(pages, space.id)}
            rowProps={rowProps}
          />
        ))}
        {(canCreate || team.length > 0) && (
          <TreeSection
            title={web ? 'Espace d’équipe' : 'Pages'}
            onAdd={canCreate ? () => void createPage(null) : undefined}
            pages={team}
            rowProps={rowProps}
            empty="Aucune page. Créez-en une."
          />
        )}
        {web && canCreate && (
          <TreeSection
            title="Privé"
            onAdd={() => void createPage(null, 'restricted')}
            pages={mine}
            rowProps={rowProps}
            empty="Vos pages visibles par vous seul."
          />
        )}
        {shared.length > 0 && (
          <TreeSection title="Partagé avec moi" pages={shared} rowProps={rowProps} />
        )}
      </div>
      <div className="sidebar-footer">
        <button onClick={() => setTransferOpen(true)}>Importer / Exporter</button>
        <button onClick={() => setTrashOpen(true)}>Corbeille</button>
        {session && (
          <div className="sidebar-account" title={session.user.email}>
            <span className="account-name">
              {session.user.name}
              {session.user.role === 'reader' ? ' (lecture seule)' : ''}
            </span>
            <span className="account-buttons">
              <button onClick={() => setSettingsOpen(true)}>
                {session.user.role === 'admin' ? 'Comptes' : 'Mon compte'}
              </button>
              <button onClick={() => void session.logout()}>Se déconnecter</button>
            </span>
          </div>
        )}
        {session && settingsOpen && <session.Settings onClose={() => setSettingsOpen(false)} />}
      </div>
    </aside>
  )
}

function TreeSection({
  title,
  onTitle,
  onAdd,
  pages,
  rowProps,
  empty
}: {
  title: string
  onTitle?: () => void
  onAdd?: () => void
  pages: PageSummary[]
  rowProps: Omit<RowProps, 'page' | 'depth' | 'flat'>
  empty?: string
}): React.JSX.Element {
  return (
    <section className="tree">
      <h4 className="tree-title">
        {onTitle ? (
          <button className="tree-title-label" onClick={onTitle}>
            {title}
          </button>
        ) : (
          <span className="tree-title-label">{title}</span>
        )}
        {onAdd && (
          <button className="tree-add" title="Nouvelle page" onClick={onAdd}>
            +
          </button>
        )}
      </h4>
      {pages.map((p) => (
        <Row key={p.id} page={p} depth={0} {...rowProps} />
      ))}
      {pages.length === 0 && empty && <p className="empty">{empty}</p>}
    </section>
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
  const createRow = useStore((s) => s.createRow)
  const exportPage = useStore((s) => s.exportPage)
  const [menu, setMenu] = useState(false)
  const presence = useStore((s) => s.presence)
  const here = [
    ...new Map(presence.filter((p) => p.pageId === page.id).map((p) => [p.userId, p])).values()
  ]
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
        <span className="icon">{page.icon ?? (page.kind === 'database' ? '🗃️' : '📄')}</span>
        <span className="label">{page.title || 'Sans titre'}</span>
        <Avatars people={here} small />
        {!flat && (
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button title="Plus" onClick={() => setMenu(!menu)}>
              ⋯
            </button>
            <button
              title={page.kind === 'database' ? 'Nouvelle ligne' : 'Sous-page'}
              onClick={() =>
                void (page.kind === 'database' ? createRow(page.id) : createPage(page.id))
              }
            >
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
            <button onClick={() => (setMenu(false), void exportPage(page.id))}>
              Exporter en Markdown
            </button>
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
