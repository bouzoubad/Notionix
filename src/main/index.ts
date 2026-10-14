import { app, shell, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/database'
import { PageRepository } from './db/pageRepository'
import { registerAssetHandlers, registerPageHandlers, registerTransferHandlers } from './ipc'
import { AssetStore } from './assets'
import { ASSET_SCHEME } from '../shared/assets'

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? {} : { icon }),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.notionix')
  if (process.platform === 'darwin') app.dock?.setIcon(icon)

  const db = openDatabase()
  const repo = new PageRepository(db)
  const assets = new AssetStore(join(app.getPath('userData'), 'assets'))
  protocol.handle(ASSET_SCHEME, (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1))
    const path = assets.pathOf(name)
    return path
      ? net.fetch(pathToFileURL(path).toString())
      : new Response('Not found', { status: 404 })
  })
  registerPageHandlers(ipcMain, repo)
  registerAssetHandlers(ipcMain, assets)
  registerTransferHandlers(ipcMain, repo, assets, {
    dialog,
    getWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  })
  app.on('before-quit', () => db.close())

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
