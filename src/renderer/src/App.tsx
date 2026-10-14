import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { SearchDialog } from './components/SearchDialog'
import { TrashDialog } from './components/TrashDialog'
import { TransferDialog } from './components/TransferDialog'
import { PageEditor } from './editor/PageEditor'
import { DatabasePage } from './database/DatabasePage'
import { Logo } from './components/Logo'

export default function App(): React.JSX.Element {
  const load = useStore((s) => s.load)
  const currentId = useStore((s) => s.currentId)
  const current = useStore((s) => s.pages.find((p) => p.id === s.currentId))
  const searchOpen = useStore((s) => s.searchOpen)
  const trashOpen = useStore((s) => s.trashOpen)
  const transferOpen = useStore((s) => s.transferOpen)
  const notice = useStore((s) => s.notice)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const createPage = useStore((s) => s.createPage)

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
      {notice && <div className="notice">{notice}</div>}
    </div>
  )
}
