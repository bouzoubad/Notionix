// E2E of the desktop app linked to a server that becomes unreachable the way a
// server behind a VPN does: nothing answers, nothing refuses (connections hang).
// The app keeps every team page of every workspace on the computer (text,
// images, databases), says when it last synced, starts at once from what it
// kept, switches workspace without network, frees the copies of a workspace
// set to "online only" (never a file a page of this computer uses), says
// plainly that such a page is not here, and comes back with the network.
// Run after `npm run build && npm run build:server`: node tests/e2e/unreachable.mjs
import { _electron as electron } from 'playwright-core'
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { connect, createServer } from 'net'
import { createServer as createTlsServer } from 'tls'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'
import { CHROMIUM_FLAGS } from './flags.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-unreachable-'))
const ADMIN = { email: 'admin@example.com', password: 'motdepasse-admin' }
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
const port = await freePort()
const tlsPort = await freePort()
const api = `http://127.0.0.1:${port}`
const url = `https://127.0.0.1:${tlsPort}`
const TLS = join(process.cwd(), 'tests/fixtures/tls')

/**
 * In front of the server, like Caddy: HTTPS with a test authority, or (`hang`)
 * a black hole that accepts connections and never answers, like an address
 * reached without the VPN.
 */
let front = null
const sockets = new Set()
const hold = (s) => {
  sockets.add(s)
  s.on('close', () => sockets.delete(s))
  s.on('error', () => s.destroy())
}
const setFront = async (mode) => {
  if (front) {
    const closing = front
    front = null
    await new Promise((resolve) => {
      closing.close(() => resolve())
      for (const s of sockets) s.destroy()
    })
  }
  front =
    mode === 'hang'
      ? createServer((socket) => hold(socket))
      : createTlsServer(
          {
            key: readFileSync(join(TLS, 'leaf.key')),
            cert:
              readFileSync(join(TLS, 'leaf.crt'), 'utf8') +
              readFileSync(join(TLS, 'intermediate.crt'), 'utf8')
          },
          (client) => {
            const upstream = connect(port, '127.0.0.1')
            for (const s of [client, upstream]) {
              hold(s)
              s.on('error', () => {
                client.destroy()
                upstream.destroy()
              })
            }
            client.pipe(upstream).pipe(client)
          }
        )
  front.on('tlsClientError', () => {})
  await new Promise((resolve) => front.listen(tlsPort, '127.0.0.1', resolve))
}

const server = spawn(process.execPath, ['out/server/main.mjs'], {
  env: {
    ...process.env,
    NOTIONIX_PORT: String(port),
    NOTIONIX_DATA_DIR: join(tmp, 'data'),
    NOTIONIX_WEB_DIR: join(process.cwd(), 'out/server/web'),
    NOTIONIX_ADMIN_EMAIL: ADMIN.email,
    NOTIONIX_ADMIN_PASSWORD: ADMIN.password,
    NOTIONIX_RELEASE_NOTES: 'off'
  },
  stdio: ['ignore', 'pipe', 'inherit']
})
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('écoute') && resolve())
  server.on('exit', (code) => reject(new Error(`server exited ${code}`)))
})
await setFront('pass')

/** The server read and written directly, like any client of its API. */
const token = (
  await fetch(`${api}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN)
  }).then((r) => r.json())
).token
const call = async (workspace, method, ...args) => {
  const res = await fetch(`${api}/api/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Notionix-Workspace': workspace
    },
    body: JSON.stringify({ method, args })
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error)
  return body.result
}
const doc = (text, ...images) =>
  JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      ...images.map((name) => ({
        type: 'image',
        attrs: { src: `notionix-asset://file/${name}` }
      }))
    ]
  })
/** A different image each time (a 1×1 PNG and one byte more), sent to a workspace. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
let seed = 0
const image = async (workspace) => {
  const bytes = Buffer.concat([PNG, Buffer.from([++seed])])
  const name = `${createHash('sha256').update(bytes).digest('hex')}.png`
  const res = await fetch(`${api}/api/assets/${name}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Notionix-Workspace': workspace,
      'X-Notionix-Client': 'web'
    },
    body: bytes
  })
  if (!res.ok) throw new Error(`image refused: ${res.status} ${await res.text()}`)
  return name
}
const other = (
  await fetch(`${api}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Projet X', memberIds: [] })
  }).then((r) => r.json())
).workspace
await call('main', 'pages.createWith', null, {
  title: 'Page équipe',
  content: doc('Bonjour équipe')
})
const imgMain = await image('main')
await call('main', 'pages.createWith', null, {
  title: 'Jamais ouverte',
  content: doc('Pas ici', imgMain)
})
const table = await call('main', 'databases.create', null)
await call('main', 'pages.update', table.id, { title: 'Suivi' })
await call('main', 'databases.createRow', table.id, { title: 'Ligne 1' })
await call(other.id, 'pages.createWith', null, { title: 'Page X', content: doc('Contenu X') })
// Never opened here: kept by the sync all the same.
const [imgA, imgB, imgC] = [await image(other.id), await image(other.id), await image(other.id)]
await call(other.id, 'pages.createWith', null, { title: 'Page X3', content: doc('Texte X3', imgC) })
await call(other.id, 'pages.createWith', null, {
  title: 'Page X2',
  content: doc('Texte X2', imgA, imgB)
})

const userData = join(tmp, 'desktop')
const kept = (name) => existsSync(join(userData, 'assets', name))
const until = async (check, what, ms = 60_000) => {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timeout: ${what}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}
const imageShown = (win, text) =>
  win.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.editor')]
        .filter((e) => e.textContent.includes(t))
        .some((e) => [...e.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth > 0)),
    text,
    { timeout: 10_000 }
  )
const launch = () =>
  electron.launch({
    args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${userData}`],
    env: { ...process.env, NOTIONIX_TEST_AUTHORITY: join(TLS, 'root.crt') }
  })
let app = await launch()
const errors = []
const watch = (win) => win.on('pageerror', (e) => errors.push(`${e}\n${e.stack ?? ''}`))
const section = (win, name) => win.locator('.workspace-section', { hasText: name })
const editorWith = (win, text) => win.locator('.editor', { hasText: text })
/** Unfolds another workspace's section (folds are remembered from one start to the next). */
const unfold = async (win, name) => {
  const fold = section(win, name).locator('.tree-fold')
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
}

try {
  let win = await app.firstWindow()
  watch(win)
  await win.getByRole('button', { name: 'Se connecter à un serveur' }).click()
  await win.getByLabel('Adresse du serveur').fill(url)
  await win.getByLabel('E-mail').fill(ADMIN.email)
  await win.getByLabel('Mot de passe').fill(ADMIN.password)
  await win.locator('form.server-connect button.primary').click()
  await section(win, 'Espace principal').getByText('Page équipe').click()
  await editorWith(win, 'Bonjour équipe').waitFor()
  // Another workspace's page: the app switches to that workspace.
  await unfold(win, 'Projet X')
  await section(win, 'Projet X').getByText('Page X', { exact: true }).click()
  await win.locator('.workspace-section.current', { hasText: 'Projet X' }).waitFor()
  await editorWith(win, 'Contenu X').waitFor()
  // The main workspace's pages listed in its section (kept for later).
  await unfold(win, 'Espace principal')
  await section(win, 'Espace principal').getByText('Jamais ouverte').waitFor()
  // Every page of both workspaces, and their images, kept in the background.
  await until(() => [imgMain, imgA, imgB, imgC].every(kept), 'images kept')
  await win.locator('.offline-status', { hasText: /^Synchronisé/ }).waitFor({ timeout: 60_000 })
  await win.waitForTimeout(1500)

  // The VPN off: the server's address swallows every connection.
  await app.close()
  await setFront('hang')
  let start = Date.now()
  app = await launch()
  win = await app.firstWindow()
  watch(win)
  await section(win, 'Projet X').getByText('Page X', { exact: true }).waitFor()
  const started = Date.now() - start
  assert.ok(started < 8000, `opened without network in ${started} ms`)
  await win.locator('.offline-banner').waitFor({ timeout: 5000 })
  await section(win, 'Projet X').getByText('Page X', { exact: true }).click()
  await editorWith(win, 'Contenu X').waitFor({ timeout: 5000 })

  // A page never opened here: there all the same, with its image; and when it was kept.
  await section(win, 'Projet X').getByText('Page X3').click()
  await editorWith(win, 'Texte X3').waitFor({ timeout: 5000 })
  await imageShown(win, 'Texte X3')
  await win.locator('.kept-badge', { hasText: 'Copie du' }).waitFor()
  await win.locator('.offline-status', { hasText: 'Hors ligne · synchronisé' }).waitFor()
  if (process.env.E2E_SHOTS)
    await win.screenshot({ path: join(process.env.E2E_SHOTS, 'offline-page.png') })

  // Switching workspace without network: its pages are there too, databases included.
  start = Date.now()
  await unfold(win, 'Espace principal')
  await section(win, 'Espace principal').getByText('Page équipe').click()
  await win.locator('.workspace-section.current', { hasText: 'Espace principal' }).waitFor()
  await editorWith(win, 'Bonjour équipe').waitFor()
  assert.ok(Date.now() - start < 8000, `switched without network in ${Date.now() - start} ms`)
  await win.locator('.offline-banner', { hasText: 'Synchronisé' }).waitFor({ timeout: 5000 })
  await section(win, 'Espace principal').getByText('Jamais ouverte').click()
  await editorWith(win, 'Pas ici').waitFor({ timeout: 5000 })
  await imageShown(win, 'Pas ici')
  await section(win, 'Espace principal').getByText('Suivi').click()
  await win.locator('.database-page', { hasText: 'Ligne 1' }).waitFor({ timeout: 5000 })

  // A page written here without network uses one of Projet X's images.
  await win.evaluate(
    (content) => window.desktop.api.pages.createWith(null, { title: 'Locale', content }),
    doc('Écrite ici', imgA)
  )
  // Projet X online only: its copies go, except the pages opened lately, and
  // the files a page of this computer (or a page kept) still uses.
  await win.locator('.offline-status').click()
  await win.locator('.offline-dialog').waitFor()
  const shot = (name) =>
    process.env.E2E_SHOTS
      ? win.screenshot({ path: join(process.env.E2E_SHOTS, `${name}.png`) })
      : undefined
  await shot('offline-dialog')
  await win.getByLabel('Hors ligne : Projet X').selectOption('online')
  await until(() => !kept(imgB), 'image of Page X2 freed', 10_000)
  assert.ok(kept(imgA), 'image used by a page of this computer kept')
  assert.ok(kept(imgC), 'image of a page opened lately kept')
  assert.ok(kept(imgMain), 'image of the main workspace kept')
  await win.locator('.offline-dialog').getByRole('button', { name: 'Fermer' }).click()
  await unfold(win, 'Projet X')
  await section(win, 'Projet X').getByText('Page X2').click()
  await win.locator('.workspace-section.current', { hasText: 'Projet X' }).waitFor()
  await win.locator('.page-offline').waitFor({ timeout: 5000 })

  // The VPN back: the app reconnects by itself, and the page shown opens.
  await setFront('pass')
  await win.locator('.offline-banner').waitFor({ state: 'detached', timeout: 60_000 })
  await editorWith(win, 'Texte X2').waitFor()
  // Left and opened again: still there.
  await section(win, 'Projet X').getByText('Page X', { exact: true }).click()
  await section(win, 'Projet X').getByText('Page X2').click()
  await editorWith(win, 'Texte X2').waitFor()

  assert.deepEqual(errors, [])
  console.log('unreachable server e2e: OK')
} catch (e) {
  console.error(e)
  console.error('page errors:', errors.join('\n---\n').slice(0, 4000))
  const win = app.windows()[0]
  if (win) {
    console.error(
      await win
        .evaluate(async () => ({
          sidebar: document.querySelector('.sidebar')?.innerText?.slice(0, 600),
          main: document.querySelector('main')?.innerText?.slice(0, 300),
          body: document.body.innerText.slice(0, 300),
          debug: await (async () => {
            const probe = await window.desktop.server.probe()
            const res = await window.desktop.server.request('/api/rpc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ method: 'pages.list', args: [] })
            })
            return { probe, status: res.status, headers: res.headers }
          })()
        }))
        .catch(() => null)
    )
    if (process.env.E2E_SHOTS)
      await win.screenshot({ path: join(process.env.E2E_SHOTS, 'unreachable-failure.png') })
  }
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  front?.close()
  for (const s of sockets) s.destroy()
  server.kill()
}
