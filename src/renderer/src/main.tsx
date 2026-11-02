import 'katex/dist/katex.min.css'
import './assets/main.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setPlatform } from './platform'

// This computer's pages; replaced by both places when the app is linked to a server.
window.api = window.desktop!.api

/** The desktop app: on this computer only, or linked to a Notionix server. */
async function start(): Promise<void> {
  const status = await window.desktop!.server.status().catch(() => null)
  let linked = false
  if (status?.signedIn) {
    try {
      const { startLinked } = await import('../../desktop/start')
      linked = await startLinked(status)
    } catch (e) {
      console.error(e)
      window.api = window.desktop!.api
    }
  }
  if (!linked) {
    const { ConnectDialog } = await import('../../desktop/ConnectDialog')
    setPlatform({
      kind: 'desktop',
      session: null,
      ServerConnect: ConnectDialog,
      signInAgain: status !== null
    })
  }
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
