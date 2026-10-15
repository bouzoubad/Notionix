import 'katex/dist/katex.min.css'
import '../renderer/src/assets/main.css'
import './web.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { assetNameFromSrc, assetSrcFromWebPath, assetWebPath } from '../shared/assets'
import { MAIN_WORKSPACE, type SessionUser, type WorkspaceInfo } from '../shared/collab'
import { currentWorkspace, switchWorkspace } from './workspace'
import { setPlatform } from '../renderer/src/platform'
import { webApi } from './api'
import { json, ServerError, whenSignedOut } from './http'
import { connect } from './session'
import { Login } from './Login'
import { SettingsDialog } from './SettingsDialog'
import { FeedbackDialog } from './FeedbackDialog'

const root = createRoot(document.getElementById('root')!)

/** Loads the app once signed in; the app's modules read `window.api` when loaded. */
async function startApp(user: SessionUser): Promise<void> {
  // A workspace one no longer belongs to (or deleted): back to the main one.
  const { workspaces } = await json<{ workspaces: WorkspaceInfo[] }>('/api/workspaces')
  if (!workspaces.some((w) => w.id === currentWorkspace())) {
    switchWorkspace(MAIN_WORKSPACE)
    return
  }
  window.api = webApi
  const { useStore } = await import('../renderer/src/store')
  setPlatform({
    kind: 'web',
    session: connect(
      user,
      () => void useStore.getState().remoteChange(),
      ({ onClose }) => <SettingsDialog user={user} onClose={onClose} />,
      ({ onClose, focus }) => <FeedbackDialog user={user} focus={focus} onClose={onClose} />
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
  // Public forms and published pages need no account.
  const form = /^\/f\/([a-z0-9]+)\/?$/.exec(location.pathname)
  if (form) {
    const { PublicForm } = await import('./PublicForm')
    root.render(<PublicForm token={form[1]} />)
    return
  }
  const published = /^\/p\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(location.pathname)
  if (published) {
    const token = published[1]
    setPlatform({
      kind: 'web',
      session: null,
      imageSrc: {
        display: (src) => {
          const name = assetNameFromSrc(src)
          return name ? `/api/public/${token}/assets/${name}` : src
        },
        stored: (url) => url
      }
    })
    const { PublicView } = await import('./PublicView')
    root.render(<PublicView token={token} pageId={published[2] ?? null} />)
    return
  }
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
