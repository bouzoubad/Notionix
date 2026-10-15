import { useEffect } from 'react'
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

  const inboxOpen = useStore((s) => s.inboxOpen)
  const setInboxOpen = useStore((s) => s.setInboxOpen)
  const refreshInbox = useStore((s) => s.refreshInbox)
  useEffect(() => {
    void refreshInbox()
    return window.api.inbox.onChange(() => void refreshInbox())
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
  }, [currentId])

  useEffect(() => {
    void load()
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [load, setSearchOpen])

  return (
    <div className="app">
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
