import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { SearchDialog } from './components/SearchDialog'
import { TrashDialog } from './components/TrashDialog'
import { TransferDialog } from './components/TransferDialog'
import { MathDialog } from './components/MathDialog'
import { PageEditor } from './editor/PageEditor'
import { DatabasePage } from './database/DatabasePage'
import { Logo } from './components/Logo'
import { InboxDialog } from './components/InboxDialog'
import { PagePicker } from './components/PagePicker'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { platform } from './platform'

export default function App(): React.JSX.Element {
  const load = useStore((s) => s.load)
  const currentId = useStore((s) => s.currentId)
  const current = useStore((s) => s.pages.find((p) => p.id === s.currentId))
  const searchOpen = useStore((s) => s.searchOpen)
  const trashOpen = useStore((s) => s.trashOpen)
  const transferOpen = useStore((s) => s.transferOpen)
  const notice = useStore((s) => s.notice)
  const mathEdit = useStore((s) => s.mathEdit)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const createPage = useStore((s) => s.createPage)

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const sidebarHidden = useStore((s) => s.sidebarHidden)
  const inboxOpen = useStore((s) => s.inboxOpen)
  const setInboxOpen = useStore((s) => s.setInboxOpen)
  const refreshInbox = useStore((s) => s.refreshInbox)
  useEffect(() => {
    void refreshInbox()
    const stopInbox = window.api.inbox.onChange(() => void refreshInbox())
    const stopDatabases = window.api.databases.onChange(
      () => void useStore.getState().remoteChange()
    )
    return () => {
      stopInbox()
      stopDatabases()
    }
  }, [refreshInbox])

  // Server workspace: presence of the others, connection state, and this person's open page.
  const connected = useStore((s) => s.connected)
  useEffect(() => {
    const session = platform().session
    if (!session) return
    const stopPresence = session.onPresence((presence) => useStore.setState({ presence }))
    const stopStatus = session.onStatus((connected) => useStore.setState({ connected }))
    return () => {
      stopPresence()
      stopStatus()
    }
  }, [])
  useEffect(() => {
    platform().session?.setPage(currentId)
    // Counted for the page's view statistics; a failure changes nothing.
    if (currentId) window.api.pages.view(currentId).catch(() => {})
  }, [currentId])

  useEffect(() => {
    void load()
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      const state = useStore.getState()
      // Cmd+K on selected text adds a link (formatting menu); elsewhere it searches, like Cmd+P.
      const selectedText =
        !!window.getSelection()?.toString() && !!document.activeElement?.closest('.ProseMirror')
      const run = (action: () => void): void => {
        e.preventDefault()
        action()
      }
      if (key === 'p' && !e.shiftKey) run(() => setSearchOpen(true))
      else if (key === 'k' && !e.shiftKey && !selectedText) run(() => setSearchOpen(true))
      else if (key === 'n' && (e.altKey || !e.shiftKey) && !e.code.startsWith('Digit'))
        run(() => void state.createPage(null))
      else if (e.code === 'BracketLeft' && !e.altKey) run(() => history.back())
      else if (e.code === 'BracketRight' && !e.altKey) run(() => history.forward())
      else if (e.code === 'Backslash') run(() => state.toggleSidebar())
      else if (e.shiftKey && key === 'l') run(() => state.toggleTheme())
      else if (e.shiftKey && key === 'u')
        run(() => {
          const parent = state.pages.find((p) => p.id === state.currentId)?.parentId
          if (parent) state.open(parent)
        })
      else if (e.code === 'Slash' && !e.shiftKey) run(() => setShortcutsOpen(true))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [load, setSearchOpen])

  return (
    <div className={`app${sidebarHidden ? ' sidebar-hidden' : ''}`}>
      <Sidebar />
      <main>
        {current?.kind === 'database' ? (
          <DatabasePage key={current.id} page={current} />
        ) : currentId ? (
          <PageEditor pageId={currentId} />
        ) : (
          <div className="blank">
            <Logo variant="wordmark" className="logo-hero" />
            <p>Vos idées. Un seul espace.</p>
            <button onClick={() => void createPage(null)}>Créer une page</button>
          </div>
        )}
      </main>
      {searchOpen && <SearchDialog />}
      {trashOpen && <TrashDialog />}
      {transferOpen && <TransferDialog />}
      <PagePicker />
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      <FeedbackWindow />
      {inboxOpen && <InboxDialog onClose={() => setInboxOpen(false)} />}
      {mathEdit && <MathDialog key={mathEdit.latex + String(mathEdit.inline)} />}
      {notice && <div className="notice">{notice}</div>}
      {!connected && (
        <div className="offline-banner">
          Connexion au serveur perdue : reconnexion… Les modifications reprendront ensuite.
        </div>
      )}
    </div>
  )
}

/** Feedback window of the server workspace (bugs and ideas). */
function FeedbackWindow(): React.JSX.Element | null {
  const feedback = useStore((s) => s.feedback)
  const close = useStore((s) => s.closeFeedback)
  const session = platform().session
  if (!session || !feedback) return null
  return <session.Feedback focus={feedback.focus} onClose={close} />
}
