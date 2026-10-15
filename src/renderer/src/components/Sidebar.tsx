import { useEffect, useRef, useState } from 'react'
import { childrenOf, pageHash, useStore } from '../store'
import { Logo } from './Logo'
import { platform } from '../platform'
import { Avatars } from './PageTopBar'
import { TemplatesDialog } from './TemplatesDialog'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { PageIcon } from './PageIcon'
import { iconText } from '../icons'
import type { PageSummary } from '../../../shared/types'
import { LANGUAGES, language, setLanguage, t, type Language } from '../../../shared/i18n'

/**
 * Keyboard of a tree row (WAI-ARIA tree): Enter opens, ↑/↓ move between
 * visible rows, → opens a branch then enters it, ← closes it then goes to
 * the parent, Home/End go to the first and last rows. Returns whether the
 * key was handled.
 */
function treeKey(
  key: string,
  row: HTMLElement,
  act: { open: () => void; expand: () => boolean; collapse: () => boolean; menu: () => void }
): boolean {
  const rows = Array.from(
    row.closest('.sidebar')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
  )
  const i = rows.indexOf(row)
  const level = Number(row.getAttribute('aria-level'))
  const focus = (target: HTMLElement | undefined): boolean => (target?.focus(), true)
  switch (key) {
    case 'Enter':
    case ' ':
      act.open()
      return true
    case 'ArrowDown':
      return focus(rows[i + 1])
    case 'ArrowUp':
      return focus(rows[i - 1])
    case 'Home':
      return focus(rows[0])
    case 'End':
      return focus(rows[rows.length - 1])
    case 'ArrowRight':
      if (act.expand()) return true
      return Number(rows[i + 1]?.getAttribute('aria-level')) > level ? focus(rows[i + 1]) : true
    case 'ArrowLeft': {
      if (act.collapse()) return true
      const parent = rows
        .slice(0, i)
        .reverse()
        .find((r) => Number(r.getAttribute('aria-level')) < level)
      return focus(parent)
    }
    case 'ContextMenu':
      act.menu()
      return true
    default:
      return false
  }
}

const openInNewTab = (id: string): void => {
  if (platform().kind === 'web') window.open(pageHash(id), '_blank')
  else useStore.getState().newTab(id)
}

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
  const [templatesOpen, setTemplatesOpen] = useState(false)
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
    <aside className="sidebar" aria-label={t('Barre latérale')}>
      <div className="sidebar-drag" />
      <div className="sidebar-brand">
        <Logo variant="wordmark" className="logo-sidebar" />
      </div>
      {session && <WorkspaceSwitcher workspaces={session.workspaces} />}
      <div className="sidebar-actions">
        <button onClick={() => setSearchOpen(true)}>
          {t('Rechercher')} <kbd>⌘K</kbd>
        </button>
        <button onClick={() => setInboxOpen(true)}>
          {t('Boîte de réception')}
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        {canCreate && <button onClick={() => void createPage(null)}>+ {t('Nouvelle page')}</button>}
        {canCreate && (
          <button onClick={() => void createDatabase(null)}>
            + {t('Nouvelle base de données')}
          </button>
        )}
      </div>
      <div className="sidebar-sections">
        {favorites.length > 0 && (
          <section role="tree" aria-label={t('Favoris')}>
            <h4>{t('Favoris')}</h4>
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
            title={`${iconText(space.icon, '👥')} ${space.title || t('Espace sans titre')}`}
            onTitle={() => open(space.id)}
            onAdd={space.level !== 'read' ? () => void createPage(space.id) : undefined}
            pages={childrenOf(pages, space.id)}
            rowProps={rowProps}
          />
        ))}
        {(canCreate || team.length > 0) && (
          <TreeSection
            title={web ? t('Espace d’équipe') : t('Pages')}
            onAdd={canCreate ? () => void createPage(null) : undefined}
            pages={team}
            rowProps={rowProps}
            empty={t('Aucune page. Créez-en une.')}
          />
        )}
        {web && canCreate && (
          <TreeSection
            title={t('Privé')}
            onAdd={() => void createPage(null, 'restricted')}
            pages={mine}
            rowProps={rowProps}
            empty={t('Vos pages visibles par vous seul.')}
          />
        )}
        {shared.length > 0 && (
          <TreeSection title={t('Partagé avec moi')} pages={shared} rowProps={rowProps} />
        )}
      </div>
      <div className="sidebar-footer">
        {canCreate && <button onClick={() => setTemplatesOpen(true)}>{t('Modèles')}</button>}
        {templatesOpen && <TemplatesDialog onClose={() => setTemplatesOpen(false)} />}
        <button onClick={() => setTransferOpen(true)}>{t('Importer / Exporter')}</button>
        <button onClick={() => setTrashOpen(true)}>{t('Corbeille')}</button>
        {session && (
          <button onClick={() => useStore.getState().openFeedback()}>
            {session.user.role === 'admin'
              ? t('Feedback des utilisateurs')
              : t('Feedback : bug ou idée')}
          </button>
        )}
        {session && (
          <div className="sidebar-account" title={session.user.email}>
            <span className="account-name">
              {session.user.name}
              {session.user.role === 'reader' ? t(' (lecture seule)') : ''}
            </span>
            <span className="account-buttons">
              <button onClick={() => setSettingsOpen(true)}>
                {session.user.role === 'admin' ? t('Administration') : t('Mon compte')}
              </button>
              <button onClick={() => void session.logout()}>{t('Se déconnecter')}</button>
            </span>
          </div>
        )}
        {session && settingsOpen && <session.Settings onClose={() => setSettingsOpen(false)} />}
        <select
          className="language-select"
          style={{ alignSelf: 'flex-start', margin: '4px 10px', fontSize: 12 }}
          aria-label={t('Langue')}
          value={language()}
          onChange={(e) => {
            setLanguage(e.target.value as Language)
            location.reload()
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
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
    <section className="tree" role="tree" aria-label={title}>
      <h4 className="tree-title">
        {onTitle ? (
          <button className="tree-title-label" onClick={onTitle}>
            {title}
          </button>
        ) : (
          <span className="tree-title-label">{title}</span>
        )}
        {onAdd && (
          <button
            className="tree-add"
            title={t('Nouvelle page')}
            aria-label={t('Nouvelle page')}
            onClick={onAdd}
          >
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
  setDrop: (target: DropTarget) => void
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
  const menuRef = useRef<HTMLDivElement>(null)
  // The menu, once open, takes the keyboard focus (first action).
  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [menu])
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

  const label = page.title || t('Sans titre')
  return (
    <div role="none">
      <div
        className={cls}
        role="treeitem"
        tabIndex={0}
        aria-level={depth + 1}
        aria-selected={currentId === page.id}
        aria-expanded={!flat && kids.length ? expanded : undefined}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          const handled = treeKey(e.key, e.currentTarget, {
            open: () => open(page.id),
            expand: () => !flat && kids.length > 0 && !expanded && (toggle(page.id), true),
            collapse: () => !flat && expanded && (toggle(page.id), true),
            menu: () => setMenu(true)
          })
          if (handled || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault()
            if (e.shiftKey && e.key === 'F10') setMenu(true)
          }
        }}
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
        onClick={(e) => {
          // Cmd/Ctrl-click opens the page in a new tab: the browser's, or the app's.
          if (e.metaKey || e.ctrlKey) openInNewTab(page.id)
          else open(page.id)
        }}
        onAuxClick={(e) => {
          if (e.button === 1) openInNewTab(page.id)
        }}
      >
        {!flat && (
          <button
            className="chevron"
            tabIndex={-1}
            aria-hidden
            onClick={(e) => (e.stopPropagation(), toggle(page.id))}
            style={{ visibility: kids.length ? 'visible' : 'hidden' }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
        <span className="icon">
          <PageIcon icon={page.icon} fallback={page.kind === 'database' ? '🗃️' : '📄'} />
        </span>
        <span className="label">{label}</span>
        <Avatars people={here} small />
        {!flat && (
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button
              title={t('Plus')}
              tabIndex={-1}
              aria-label={t('Plus d’actions pour {label}', { label })}
              onClick={() => setMenu(!menu)}
            >
              ⋯
            </button>
            <button
              tabIndex={-1}
              aria-label={
                page.kind === 'database'
                  ? t('Nouvelle ligne dans {label}', { label })
                  : t('Nouvelle sous-page dans {label}', { label })
              }
              title={page.kind === 'database' ? t('Nouvelle ligne') : t('Sous-page')}
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
            role="menu"
            aria-label={t('Actions pour {label}', { label })}
            onMouseLeave={() => setMenu(false)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setMenu(false)
                ;(e.currentTarget.parentElement as HTMLElement | null)?.focus()
              }
            }}
            ref={menuRef}
          >
            <button
              onClick={() => (setMenu(false), void patch(page.id, { favorite: !page.favorite }))}
            >
              {page.favorite ? t('Retirer des favoris') : t('Ajouter aux favoris')}
            </button>
            <button onClick={() => (setMenu(false), void duplicate(page.id))}>
              {t('Dupliquer')}
            </button>
            <button onClick={() => (setMenu(false), void exportPage(page.id))}>
              {t('Exporter en Markdown')}
            </button>
            <button onClick={() => (setMenu(false), void trash(page.id))}>
              {t('Mettre à la corbeille')}
            </button>
          </div>
        )}
      </div>
      {!flat && expanded && kids.length > 0 && (
        <div role="group">
          {kids.map((k) => (
            <Row key={k.id} {...props} page={k} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
