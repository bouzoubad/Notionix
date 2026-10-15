// A plain browser window for the web e2e tests: Electron's Chromium opening
// the server's address, with no Notionix code of its own (no preload).
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: true })
  void win.loadURL(process.env.NOTIONIX_URL)
})
app.on('window-all-closed', () => app.quit())
