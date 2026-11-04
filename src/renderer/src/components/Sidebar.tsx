import { AppearanceSettings } from './AppearanceSettings'
import { useEffect, useRef, useState } from 'react'
import { childrenOf, openInNewTab, useStore } from '../store'
import { Logo } from './Logo'
import { isLocalPage, platform, type ServerSession } from '../platform'
import { Avatars } from './PageTopBar'
import { TemplatesDialog } from './TemplatesDialog'
import { PageIcon } from './PageIcon'
import { iconText } from '../icons'
import type { PageSummary } from '../../../shared/types'
import type { WorkspaceInfo } from '../../../shared/collab'
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

type DropTarget = { id: string; where: 'before' | 'inside' | 'after' } | null

const WORKSPACES_KEY = 'notionix.sidebar.workspaces'

/** Sections of the sidebar folded or unfolded by this person (this browser). */
const FOLDED_KEY = 'notionix.sidebar.folded'
function readFolded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}
function useFolded(key: string, foldedByDefault: boolean): [boolean, () => void] {
  const [folded, setFolded] = useState(() => readFolded()[key] ?? foldedByDefault)
  const toggle = (): void => {
    const next = !folded
    setFolded(next)
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify({ ...readFolded(), [key]: next }))
    } catch {
      // Without storage the section is folded for this visit only.
    }
  }
  return [folded, toggle]
}

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
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const unread = useStore((s) => s.inboxUnread)
  const setInboxOpen = useStore((s) => s.setInboxOpen)
  // The workspaces of the server, each a section of the sidebar as Notion's teamspaces.
  // Kept from the last visit, so the sections do not appear late.
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>(() => {
    try {
      return session
        ? (JSON.parse(localStorage.getItem(WORKSPACES_KEY) ?? '[]') as WorkspaceInfo[])
        : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    if (!session) return
    let cancelled = false
    session.workspaces
      .list()
      .then((list) => {
        if (cancelled) return
        const shown = list.filter((w) => !w.archived || w.id === session.workspaces.current)
        setWorkspaces(shown)
        try {
          localStorage.setItem(WORKSPACES_KEY, JSON.stringify(shown))
        } catch {
          // kept for this visit only
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [session])
  const sections = session !== null && workspaces.length > 1

  const favorites = pages.filter((p) => p.favorite && !p.trashedAt)
  const open = useStore((s) => s.open)
  const web = session !== null
  const me = session?.user.id ?? null
  const canCreate = !session || (session.user.role !== 'guest' && session.user.role !== 'reader')
  const Connect = platform().ServerConnect
  const [connectOpen, setConnectOpen] = useState(platform().signInAgain === true)
  // Desktop app linked to a server: pages written without network wait on this computer.
  const linked = web && platform().isLocal !== undefined
  // Sections: teamspaces, the workspace, private pages, and pages shared on their own.
  const roots = childrenOf(pages, null)
  const onComputer = linked ? roots.filter((p) => isLocalPage(p.id)) : []
  const spaces = roots.filter((p) => p.isSpace && p.parentId === null && !onComputer.includes(p))
  const isPrivate = (p: PageSummary): boolean =>
    p.parentId === null && p.access === 'restricted' && p.createdBy === me
  const isShared = (p: PageSummary): boolean =>
    p.parentId !== null || (p.access === 'restricted' && p.createdBy !== me)
  const others = roots.filter((p) => !(p.isSpace && p.parentId === null) && !onComputer.includes(p))
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
        {sections && session ? (
          <>
            <h4 className="sidebar-group">{t('Espaces d’équipe')}</h4>
            {workspaces.map((w) =>
              w.id === session.workspaces.current ? (
                <TreeSection
                  key={w.id}
                  title={w.name}
                  icon={w.icon || '🏢'}
                  foldKey={`workspace:${w.id}`}
                  className="workspace-section current"
                  onAdd={canCreate ? () => void createPage(null) : undefined}
                  pages={team}
                  rowProps={rowProps}
                  empty={t('Aucune page. Créez-en une.')}
                />
              ) : (
                <OtherWorkspace key={w.id} info={w} session={session} />
              )
            )}
          </>
        ) : (
          (canCreate || team.length > 0) && (
            <TreeSection
              title={web ? t('Espace d’équipe') : t('Pages')}
              onAdd={canCreate ? () => void createPage(null) : undefined}
              pages={team}
              rowProps={rowProps}
              empty={t('Aucune page. Créez-en une.')}
            />
          )
        )}
        {web && canCreate && (
          <TreeSection
            title={t('Privé')}
            onAdd={() => void createPage(null, 'restricted')}
            // Linked desktop app: with the pages written here without network, sent when it is back.
            pages={[...mine, ...onComputer]}
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
        {!session && Connect && (
          <button onClick={() => setConnectOpen(true)}>
            {platform().signInAgain
              ? t('Se reconnecter au serveur')
              : t('Se connecter à un serveur')}
          </button>
        )}
        {!session && Connect && connectOpen && <Connect onClose={() => setConnectOpen(false)} />}
        {!session && <button onClick={() => setAppearanceOpen(true)}>{t('Apparence')}</button>}
        {!session && appearanceOpen && (
          <div className="overlay" onMouseDown={() => setAppearanceOpen(false)}>
            <div
              className="dialog appearance"
              role="dialog"
              aria-label={t('Apparence')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3>{t('Apparence')}</h3>
              <AppearanceSettings />
            </div>
          </div>
        )}
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
  icon,
  foldKey,
  className,
  onTitle,
  onAdd,
  pages,
  rowProps,
  empty
}: {
  title: string
  /** Icon before the title (a workspace's) */
  icon?: string
  /** The section can be folded; its state is kept under this key */
  foldKey?: string
  className?: string
  onTitle?: () => void
  onAdd?: () => void
  pages: PageSummary[]
  rowProps: Omit<RowProps, 'page' | 'depth' | 'flat'>
  empty?: string
}): React.JSX.Element {
  const [folded, toggleFold] = useFolded(foldKey ?? '', false)
  const hidden = foldKey !== undefined && folded
  const label = (
    <>
      {icon && (
        <span className="tree-title-icon">
          <PageIcon icon={icon} />
        </span>
      )}
      {title}
    </>
  )
  return (
    <section
      className={['tree', className].filter(Boolean).join(' ')}
      role="tree"
      aria-label={title}
    >
      <h4 className="tree-title">
        {foldKey !== undefined && (
          <button
            className="tree-fold"
            aria-expanded={!hidden}
            aria-label={hidden ? t('Déplier {title}', { title }) : t('Replier {title}', { title })}
            onClick={toggleFold}
          >
            {hidden ? '▸' : '▾'}
          </button>
        )}
        {onTitle ? (
          <button className="tree-title-label" onClick={onTitle}>
            {label}
          </button>
        ) : foldKey !== undefined ? (
          <button className="tree-title-label" onClick={toggleFold}>
            {label}
          </button>
        ) : (
          <span className="tree-title-label">{label}</span>
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
      {!hidden && pages.map((p) => <Row key={p.id} page={p} depth={0} {...rowProps} />)}
      {!hidden && pages.length === 0 && empty && <p className="empty">{empty}</p>}
    </section>
  )
}

/**
 * Another workspace of the server, as a section of the sidebar: its pages are
 * read when it is unfolded; opening one opens its workspace on it.
 */
function OtherWorkspace({
  info,
  session
}: {
  info: WorkspaceInfo
  session: ServerSession
}): React.JSX.Element {
  const [folded, toggleFold] = useFolded(`workspace:${info.id}`, true)
  const [pages, setPages] = useState<PageSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (folded || pages) return
    let cancelled = false
    session.workspaces
      .pagesOf(info.id)
      .then((list) => !cancelled && setPages(list.filter((p) => !p.trashedAt)))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [folded, pages, info.id, session])
  const go = (pageId: string | null): void => session.workspaces.switchTo(info.id, pageId)
  const roots = pages ? childrenOf(pages, null).filter((p) => p.kind !== 'synced') : []
  return (
    <section className="tree workspace-section" role="tree" aria-label={info.name}>
      <h4 className="tree-title">
        <button
          className="tree-fold"
          aria-expanded={!folded}
          aria-label={
            folded
              ? t('Déplier {title}', { title: info.name })
              : t('Replier {title}', { title: info.name })
          }
          onClick={toggleFold}
        >
          {folded ? '▸' : '▾'}
        </button>
        <button
          className="tree-title-label workspace-open"
          title={t('Ouvrir l’espace {name}', { name: info.name })}
          onClick={() => go(null)}
        >
          <span className="tree-title-icon">
            <PageIcon icon={info.icon || '🏢'} />
          </span>
          {info.name}
        </button>
      </h4>
      {!folded &&
        (pages === null ? (
          <p className="empty">
            {failed ? t('Espace injoignable pour le moment.') : t('Chargement…')}
          </p>
        ) : roots.length === 0 ? (
          <p className="empty">{t('Aucune page.')}</p>
        ) : (
          roots.map((p) => <RemoteRow key={p.id} page={p} pages={pages} depth={0} go={go} />)
        ))}
    </section>
  )
}

/** A page of another workspace: opening it opens that workspace. */
function RemoteRow({
  page,
  pages,
  depth,
  go
}: {
  page: PageSummary
  pages: PageSummary[]
  depth: number
  go: (pageId: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const kids = childrenOf(pages, page.id)
  const label = page.title || t('Sans titre')
  return (
    <div role="none">
      <div
        className="row"
        role="treeitem"
        tabIndex={0}
        aria-level={depth + 1}
        aria-expanded={kids.length ? expanded : undefined}
        aria-label={label}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => go(page.id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          const handled = treeKey(e.key, e.currentTarget, {
            open: () => go(page.id),
            expand: () => kids.length > 0 && !expanded && (setExpanded(true), true),
            collapse: () => expanded && (setExpanded(false), true),
            menu: () => undefined
          })
          if (handled) e.preventDefault()
        }}
      >
        <button
          className="chevron"
          tabIndex={-1}
          aria-hidden
          onClick={(e) => (e.stopPropagation(), setExpanded(!expanded))}
          style={{ visibility: kids.length ? 'visible' : 'hidden' }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="icon">
          <PageIcon icon={page.icon} fallback={page.kind === 'database' ? '🗃️' : '📄'} />
        </span>
        <span className="label">{label}</span>
      </div>
      {expanded && kids.length > 0 && (
        <div role="group">
          {kids.map((k) => (
            <RemoteRow key={k.id} page={k} pages={pages} depth={depth + 1} go={go} />
          ))}
        </div>
      )}
    </div>
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
            <button onClick={() => (setMenu(false), openInNewTab(page.id))}>
              {t('Ouvrir dans un nouvel onglet')}
            </button>
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
