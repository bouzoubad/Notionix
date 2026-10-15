import { useState } from 'react'
import { useStore } from '../store'
import { platform } from '../platform'
import { gettingStartedPage } from './gettingStarted'

const KEY = 'welcomeDismissed'
const dismissed = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

/** First steps, on the home screen until dismissed. */
export function Welcome({
  onTour,
  onShortcuts
}: {
  onTour: () => void
  onShortcuts: () => void
}): React.JSX.Element | null {
  const [hidden, setHidden] = useState(dismissed)
  const load = useStore((s) => s.load)
  const open = useStore((s) => s.open)
  const setTransferOpen = useStore((s) => s.setTransferOpen)
  const showNotice = useStore((s) => s.showNotice)
  const session = platform().session
  const canCreate = !session || !['reader', 'guest'].includes(session.user.role)
  if (hidden) return null
  const hide = (): void => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // shown again next time
    }
    setHidden(true)
  }
  const createGuide = async (): Promise<void> => {
    try {
      const page = await window.api.pages.createWith(null, gettingStartedPage(!!session))
      await load()
      open(page.id)
    } catch (e) {
      showNotice(`Page non créée : ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">Bien démarrer</h2>
      <ul>
        <li>
          <button onClick={onTour}>🧭 Visite guidée (1 minute)</button>
        </li>
        {canCreate && (
          <li>
            <button onClick={() => void createGuide()}>👋 Créer la page « Bien démarrer »</button>
          </li>
        )}
        {canCreate && (
          <li>
            <button onClick={() => setTransferOpen(true)}>
              📦 Importer depuis Notion, Word, Evernote…
            </button>
          </li>
        )}
        <li>
          <button onClick={onShortcuts}>⌨️ Les raccourcis clavier</button>
        </li>
      </ul>
      <button className="welcome-close" onClick={hide}>
        Ne plus afficher
      </button>
    </section>
  )
}
