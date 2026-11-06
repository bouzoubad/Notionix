// E2E of the desktop app linked to a server that becomes unreachable the way a
// server behind a VPN does: nothing answers, nothing refuses (connections hang).
// The app must start at once from what it kept, in any workspace, open the
// pages already opened here (in each workspace), switch workspace, say plainly
// that a page never opened here is not available, and come back with the network.
// Run after `npm run build && npm run build:server`: node tests/e2e/unreachable.mjs
import { _electron as electron } from 'playwright-core'
import { spawn } from 'child_process'
import { mkdtempSync, readFileSync } from 'fs'
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
const doc = (text) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  })
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
await call('main', 'pages.createWith', null, { title: 'Jamais ouverte', content: doc('Pas ici') })
await call(other.id, 'pages.createWith', null, { title: 'Page X', content: doc('Contenu X') })

const userData = join(tmp, 'desktop')
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
  await section(win, 'Projet X').getByText('Page X').click()
  await win.locator('.workspace-section.current', { hasText: 'Projet X' }).waitFor()
  await editorWith(win, 'Contenu X').waitFor()
  // The main workspace's pages listed in its section (kept for later).
  await unfold(win, 'Espace principal')
  await section(win, 'Espace principal').getByText('Jamais ouverte').waitFor()
  await win.waitForTimeout(1000)

  // The VPN off: the server's address swallows every connection.
  await app.close()
  await setFront('hang')
  let start = Date.now()
  app = await launch()
  win = await app.firstWindow()
  watch(win)
  await section(win, 'Projet X').getByText('Page X').waitFor()
  const started = Date.now() - start
  assert.ok(started < 8000, `opened without network in ${started} ms`)
  await win.locator('.offline-banner').waitFor({ timeout: 5000 })
  await section(win, 'Projet X').getByText('Page X').click()
  await editorWith(win, 'Contenu X').waitFor({ timeout: 5000 })

  // Switching workspace without network: the pages opened there open again.
  start = Date.now()
  await unfold(win, 'Espace principal')
  await section(win, 'Espace principal').getByText('Page équipe').click()
  await win.locator('.workspace-section.current', { hasText: 'Espace principal' }).waitFor()
  await editorWith(win, 'Bonjour équipe').waitFor()
  assert.ok(Date.now() - start < 8000, `switched without network in ${Date.now() - start} ms`)
  await win.locator('.offline-banner').waitFor({ timeout: 5000 })
  // A page never opened here says so, instead of an empty window.
  start = Date.now()
  await section(win, 'Espace principal').getByText('Jamais ouverte').click()
  await win.locator('.page-offline').waitFor({ timeout: 5000 })
  assert.ok(Date.now() - start < 5000)

  // The VPN back: the app reconnects by itself, and the page shown opens.
  await setFront('pass')
  await win.locator('.offline-banner').waitFor({ state: 'detached', timeout: 60_000 })
  await editorWith(win, 'Pas ici').waitFor()
  // Left and opened again: still there.
  await section(win, 'Espace principal').getByText('Page équipe').click()
  await editorWith(win, 'Bonjour équipe').waitFor()
  await section(win, 'Espace principal').getByText('Jamais ouverte').click()
  await editorWith(win, 'Pas ici').waitFor()

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
