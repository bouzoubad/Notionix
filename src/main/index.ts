import { app, shell, BrowserWindow, dialog, ipcMain, net, Notification, protocol } from 'electron'
import { pathToFileURL } from 'url'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from '../core/db/database'
import { PageRepository } from '../core/db/pageRepository'
import {
  registerAssetHandlers,
  registerDatabaseHandlers,
  registerPageHandlers,
  registerTransferHandlers,
  registerTeamHandlers,
  LOCAL_PERSON
} from './ipc'
import { reminderKey, TeamRepository } from '../core/db/teamRepository'
import { docHasMention } from '../core/db/text'
import { DatabaseRepository } from '../core/db/databaseRepository'
import { AssetStore } from '../core/assets'
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

  const db = openDatabase(join(app.getPath('userData'), 'notionix.db'))
  const repo = new PageRepository(db)
  repo.actor = LOCAL_PERSON.id
  const assets = new AssetStore(join(app.getPath('userData'), 'assets'))
  protocol.handle(ASSET_SCHEME, (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1))
    const path = assets.pathOf(name)
    return path
      ? net.fetch(pathToFileURL(path).toString())
      : new Response('Not found', { status: 404 })
  })
  registerPageHandlers(ipcMain, repo)
  const dbs = new DatabaseRepository(repo)
  const team = new TeamRepository(db)
  registerTeamHandlers(ipcMain, team)
  // Reminders: a system notification, and an entry in the inbox.
  const reminders = setInterval(() => {
    for (const r of team.takeDueReminders()) {
      if (!docHasMention(repo.get(r.pageId)?.content ?? '', reminderKey(r))) continue
      team.notify([r.userId], { kind: 'reminder', pageId: r.pageId, actorId: null, text: r.text })
      if (Notification.isSupported()) new Notification({ title: 'Notionix', body: r.text }).show()
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('inbox:changed')
    }
  }, 30_000)
  app.on('before-quit', () => clearInterval(reminders))
  // The trash keeps pages 30 days.
  repo.purgeTrash()
  const purge = setInterval(() => repo.purgeTrash(), 6 * 60 * 60 * 1000)
  app.on('before-quit', () => clearInterval(purge))
  registerDatabaseHandlers(ipcMain, dbs)
  const dialogs = {
    dialog,
    getWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  }
  registerAssetHandlers(ipcMain, assets, dialogs)
  registerTransferHandlers(ipcMain, repo, dbs, assets, dialogs)
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
