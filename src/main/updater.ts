import { app, type IpcMain, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/desktop'

/** How often the linked server is asked for a newer app. */
const EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Updates of the desktop app from the linked Notionix server (its
 * /download/latest-mac.yml): downloaded in the background, installed when
 * the person restarts the app (or quits it). The new version must be signed
 * like this one, or macOS refuses it. Only a packaged app updates itself.
 */
export function registerUpdates(
  ipc: IpcMain,
  serverUrl: () => string | null,
  pages: () => WebContents[]
): void {
  let state: UpdateState = { status: app.isPackaged ? 'idle' : 'unsupported' }
  const set = (next: UpdateState): void => {
    state = next
    for (const page of pages()) page.send('updates:changed', state)
  }
  ipc.handle('updates:state', () => state)
  ipc.handle('updates:install', () => {
    if (state.status === 'ready') autoUpdater.quitAndInstall(false, true)
  })
  if (!app.isPackaged) {
    ipc.handle('updates:check', () => state)
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // The server sends whole files only.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.logger = {
    info: () => undefined,
    warn: (m: unknown) => console.warn('[updates]', m),
    error: (m: unknown) => console.error('[updates]', m),
    debug: () => undefined
  }
  autoUpdater.on('update-available', (info) =>
    set({ status: 'downloading', version: info.version, percent: 0 })
  )
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') set({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }))
  autoUpdater.on('update-not-available', () => {
    if (state.status !== 'ready') set({ status: 'idle' })
  })
  autoUpdater.on('error', (e) => {
    if (state.status !== 'ready')
      set({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  })

  let checking: Promise<unknown> | null = null
  const check = async (): Promise<UpdateState> => {
    const url = serverUrl()
    if (!url || state.status === 'ready' || state.status === 'downloading') return state
    autoUpdater.setFeedURL({ provider: 'generic', url: `${url}/download` })
    checking ??= autoUpdater
      .checkForUpdates()
      .catch(() => undefined)
      .finally(() => (checking = null))
    await checking
    return state
  }
  ipc.handle('updates:check', () => check())
  setInterval(() => void check(), EVERY_MS).unref()
}
