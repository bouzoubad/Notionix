import 'katex/dist/katex.min.css'
import '../renderer/src/assets/main.css'
import './web.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { assetNameFromSrc, assetSrcFromWebPath, assetWebPath } from '../shared/assets'
import type { SessionUser } from '../shared/collab'
import { setPlatform } from '../renderer/src/platform'
import { webApi } from './api'
import { json, ServerError, whenSignedOut } from './http'
import { connect } from './session'
import { Login } from './Login'
import { SettingsDialog } from './SettingsDialog'

const root = createRoot(document.getElementById('root')!)

/** Loads the app once signed in; the app's modules read `window.api` when loaded. */
async function startApp(user: SessionUser): Promise<void> {
  window.api = webApi
  const { useStore } = await import('../renderer/src/store')
  setPlatform({
    kind: 'web',
    session: connect(
      user,
      () => void useStore.getState().remoteChange(),
      ({ onClose }) => <SettingsDialog user={user} onClose={onClose} />
    ),
    imageSrc: {
      display: (src) => {
        const name = assetNameFromSrc(src)
        return name ? assetWebPath(name) : src
      },
      stored: assetSrcFromWebPath
    }
  })
  whenSignedOut(() => location.reload())
  const { default: App } = await import('../renderer/src/App')
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

async function main(): Promise<void> {
  try {
    const { user } = await json<{ user: SessionUser }>('/api/me')
    await startApp(user)
  } catch (e) {
    if (e instanceof ServerError && e.status === 401) {
      root.render(<Login onSignedIn={(user) => void startApp(user)} />)
    } else {
      root.render(
        <div className="web-error">
          Serveur Notionix injoignable : {e instanceof Error ? e.message : String(e)}
        </div>
      )
    }
  }
}

void main()
