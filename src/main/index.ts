import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/database'
import { PageRepository } from './db/pageRepository'
import { registerPageHandlers, registerTransferHandlers } from './ipc'

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
  registerPageHandlers(ipcMain, repo)
  registerTransferHandlers(ipcMain, repo, {
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
