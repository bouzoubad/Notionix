import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { SearchDialog } from './components/SearchDialog'
import { TrashDialog } from './components/TrashDialog'
import { PageEditor } from './editor/PageEditor'

export default function App(): React.JSX.Element {
  const load = useStore((s) => s.load)
  const currentId = useStore((s) => s.currentId)
  const searchOpen = useStore((s) => s.searchOpen)
  const trashOpen = useStore((s) => s.trashOpen)
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
        {currentId ? (
          <PageEditor pageId={currentId} />
        ) : (
          <div className="blank">
            <h2>Bienvenue dans Notionix</h2>
            <button onClick={() => void createPage(null)}>Créer une page</button>
          </div>
        )}
      </main>
      {searchOpen && <SearchDialog />}
      {trashOpen && <TrashDialog />}
    </div>
  )
}
