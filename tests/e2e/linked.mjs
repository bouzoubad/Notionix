// E2E of the desktop app linked to a Notionix server: every page is on the
// server (private ones visible to their author only); without network the
// pages kept here open and can be edited, renamed, and new ones written, and
// all of it reaches the server on reconnection.
// The server is behind HTTPS with its own authority (like Caddy's), which the
// computer does not trust but the app does (NOTIONIX_TEST_AUTHORITY stands for
// the authorities shipped in resources/authorities). A new account is then
// activated in the app with its link.
// Run after `npm run build && npm run build:server`: node tests/e2e/linked.mjs
import { _electron as electron } from 'playwright-core'
import { spawn } from 'child_process'
import { mkdtempSync, readFileSync } from 'fs'
import { connect, createServer } from 'net'
import { createServer as createTlsServer } from 'tls'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'
import { CHROMIUM_FLAGS } from './flags.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-linked-'))
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
/** The server itself (the test reads it directly), and its HTTPS address (the app's). */
const api = `http://127.0.0.1:${port}`
const url = `https://127.0.0.1:${tlsPort}`
const TLS = join(process.cwd(), 'tests/fixtures/tls')

/** HTTPS in front of the server, like Caddy: certificate from a test authority. */
let tls = null
const sockets = new Set()
const startTls = () =>
  new Promise((resolve) => {
    tls = createTlsServer(
      {
        key: readFileSync(join(TLS, 'leaf.key')),
        cert:
          readFileSync(join(TLS, 'leaf.crt'), 'utf8') +
          readFileSync(join(TLS, 'intermediate.crt'), 'utf8')
      },
      (client) => {
        const upstream = connect(port, '127.0.0.1')
        for (const s of [client, upstream]) {
          sockets.add(s)
          s.on('close', () => sockets.delete(s))
          s.on('error', () => {
            client.destroy()
            upstream.destroy()
          })
        }
        client.pipe(upstream).pipe(client)
      }
    )
    tls.on('tlsClientError', () => {})
    tls.listen(tlsPort, '127.0.0.1', resolve)
  })
const stopTls = () => {
  if (!tls) return
  tls.close()
  tls = null
  for (const s of sockets) s.destroy()
}

let server = null
const startServer = async () => {
  await startTls()
  server = spawn(process.execPath, ['out/server/main.mjs'], {
    env: {
      ...process.env,
      NOTIONIX_PORT: String(port),
      NOTIONIX_DATA_DIR: join(tmp, 'data'),
      NOTIONIX_WEB_DIR: join(process.cwd(), 'out/server/web'),
      NOTIONIX_ADMIN_EMAIL: ADMIN.email,
      NOTIONIX_ADMIN_PASSWORD: ADMIN.password
    },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('écoute') && resolve())
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)))
  })
}
const stopServer = async () => {
  stopTls()
  const s = server
  server = null
  if (!s) return
  await new Promise((resolve) => {
    s.removeAllListeners('exit')
    s.on('exit', resolve)
    s.kill()
  })
}

/** What the server holds, read with the API like any client. */
let token = null
const call = async (method, ...args) => {
  if (!token) {
    const res = await fetch(`${api}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN)
    })
    token = (await res.json()).token
  }
  const res = await fetch(`${api}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, args })
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error)
  return body.result
}
const until = async (check, what, timeout = 15_000) => {
  const end = Date.now() + timeout
  for (;;) {
    if (await check().catch(() => false)) return
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

await startServer()
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'desktop')}`],
  env: { ...process.env, NOTIONIX_TEST_AUTHORITY: join(TLS, 'root.crt') }
})
const cleanup = async () => {
  await app.close().catch(() => {})
  await stopServer()
}

try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))

  // Linked to the server from the sidebar
  await win.getByRole('button', { name: 'Se connecter à un serveur' }).click()
  await win.getByLabel('Adresse du serveur').fill(url)
  await win.getByLabel('E-mail').fill(ADMIN.email)
  await win.getByLabel('Mot de passe').fill('mauvais')
  await win.locator('form.server-connect button.primary').click()
  await win.locator('.server-connect-error').waitFor()
  await win.getByLabel('Mot de passe').fill(ADMIN.password)
  await win.locator('form.server-connect button.primary').click()
  const privateSection = win.getByRole('tree', { name: 'Privé' })
  await privateSection.waitFor()
  assert.equal(await win.getByRole('button', { name: 'Se déconnecter' }).count(), 1)
  // What changed in Notionix: announced to everyone, opens its page
  const news = win.locator('.news-notice')
  await news.waitFor()
  assert.ok((await news.innerText()).includes('Nouveautés'))
  await news.getByRole('button', { name: 'Voir' }).click()
  // The latest one opens; all are seen (the page « Nouveautés de Notionix » lists them).
  await win.waitForFunction(() => document.querySelector('.page-title')?.value.includes(' — '))
  await news.waitFor({ state: 'detached' })
  const newPage = async (section) => {
    await section.locator('.tree-title').hover()
    await section.getByRole('button', { name: 'Nouvelle page' }).click()
    await win.waitForFunction(() => document.querySelector('.page-title')?.value === '')
  }

  // A private page: on the server, visible to its author only
  await newPage(privateSection)
  assert.equal(await win.locator('.local-badge').count(), 0)
  await win.locator('.page-title').fill('Secret serveur')
  await win.locator('.page-title').press('Enter')
  await win.keyboard.type('Visible par moi seul')
  await privateSection.getByText('Secret serveur').waitFor()

  // A team page
  await win.getByRole('button', { name: '+ Nouvelle page' }).click()
  await win.waitForFunction(() => document.querySelector('.page-title')?.value === '')
  await win.locator('.page-title').fill('Page équipe')
  await win.locator('.page-title').press('Enter')
  await win.keyboard.type('Bonjour équipe')
  await win.getByRole('tree', { name: 'Espace d’équipe' }).getByText('Page équipe').waitFor()

  let team = null
  let secret = null
  await until(async () => {
    const pages = await call('pages.list')
    team = pages.find((p) => p.title === 'Page équipe')
    secret = pages.find((p) => p.title === 'Secret serveur')
    if (!team || !secret) return false
    const [a, b] = await Promise.all([call('pages.get', team.id), call('pages.get', secret.id)])
    return a.content.includes('Bonjour équipe') && b.content.includes('Visible par moi seul')
  }, 'pages stored by the server')
  assert.equal(secret.access, 'restricted')
  // Another person does not see the private page.
  const other = await fetch(`${api}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email: 'autre@example.com',
      name: 'Autre',
      role: 'editor',
      password: 'autre-mot-de-passe'
    })
  })
  assert.equal(other.status, 201)
  const otherToken = (
    await fetch(`${api}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'autre@example.com', password: 'autre-mot-de-passe' })
    }).then((r) => r.json())
  ).token
  const seen = await fetch(`${api}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` },
    body: JSON.stringify({ method: 'pages.list', args: [] })
  }).then((r) => r.json())
  assert.ok(!seen.result.some((p) => p.id === secret.id), 'private to its author')
  assert.ok(seen.result.some((p) => p.id === team.id))

  // Without network: the pages kept here open and stay editable
  await stopServer()
  await win.locator('.offline-banner').waitFor()
  await win.reload()
  await privateSection.getByText('Secret serveur').click()
  await win.locator('.editor', { hasText: 'Visible par moi seul' }).waitFor()
  await win.locator('.editor p', { hasText: 'Visible par moi seul' }).click()
  await win.keyboard.press('End')
  await win.keyboard.type(' et hors ligne')
  await win.waitForTimeout(800)
  // A server page renamed without network: shown at once, sent later
  await win.getByRole('tree', { name: 'Espace d’équipe' }).getByText('Page équipe').click()
  await win.locator('.editor', { hasText: 'Bonjour équipe' }).waitFor()
  await win.locator('.page-title').fill('Page équipe renommée')
  await win.locator('.page-title').press('Enter')
  await win
    .getByRole('tree', { name: 'Espace d’équipe' })
    .getByText('Page équipe renommée')
    .waitFor()
  // A new private page, written on this computer until the network is back
  await newPage(privateSection)
  await win.locator('.local-badge').waitFor()
  await win.locator('.page-title').fill('Écrite hors ligne')
  await win.locator('.page-title').press('Enter')
  await win.keyboard.type('Sans réseau')
  await win.waitForTimeout(800)
  await privateSection.getByText('Écrite hors ligne').waitFor()
  // Left for another page: it can be sent.
  await privateSection.getByText('Secret serveur').click()
  await win.locator('.editor', { hasText: 'Visible par moi seul' }).waitFor()

  // Network back: everything written offline reaches the server
  await startServer()
  token = null
  await win.locator('.offline-banner').waitFor({ state: 'detached', timeout: 30_000 })
  await until(
    async () =>
      (await call('pages.get', secret.id)).content.includes('Visible par moi seul et hors ligne'),
    'offline edit merged on the server',
    30_000
  )
  await until(
    async () => (await call('pages.get', team.id)).title === 'Page équipe renommée',
    'offline rename sent',
    30_000
  )
  let sent = null
  await until(
    async () => {
      sent = (await call('pages.list')).find((p) => p.title === 'Écrite hors ligne')
      return Boolean(sent) && (await call('pages.get', sent.id)).content.includes('Sans réseau')
    },
    'page written offline sent to the server',
    90_000
  )
  assert.equal(sent.access, 'restricted')
  await privateSection.getByText('Écrite hors ligne').click()
  await win.locator('.editor', { hasText: 'Sans réseau' }).waitFor()
  assert.equal(await win.locator('.local-badge').count(), 0, 'now a page of the server')

  // Signing out: nothing of the account stays shown
  await win.getByRole('button', { name: 'Se déconnecter' }).click()
  await win.getByRole('button', { name: 'Se connecter à un serveur' }).waitFor()
  assert.equal(await win.locator('.sidebar').getByText('Secret serveur').count(), 0)
  assert.equal(await win.locator('.sidebar').getByText('Écrite hors ligne').count(), 0)

  // A new account, activated in the app with the link shared through Keeper
  await call('pages.list')
  const created = await fetch(`${api}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email: 'nouvelle@example.com', name: 'Nouvelle', role: 'editor' })
  }).then((r) => r.json())
  assert.ok(created.activation?.token, 'activation link issued')
  await win.getByRole('button', { name: 'Se connecter à un serveur' }).click()
  await win.getByLabel('Adresse du serveur').fill(`${url}/activate/${created.activation.token}`)
  await win.locator('.server-connect').getByText('nouvelle@example.com').waitFor()
  assert.equal(await win.getByLabel('E-mail').count(), 0)
  await win.getByLabel('Mot de passe (10 caractères minimum)').fill('nouveau-mot-de-passe')
  await win.getByLabel('Mot de passe, à nouveau').fill('nouveau-mot-de-passe')
  await win.getByRole('button', { name: 'Activer mon compte' }).click()
  await win.locator('.sidebar-account', { hasText: 'Nouvelle' }).waitFor()
  assert.equal(await win.locator('.sidebar').getByText('Secret serveur').count(), 0)
  const signedIn = await fetch(`${api}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nouvelle@example.com', password: 'nouveau-mot-de-passe' })
  })
  assert.equal(signedIn.status, 200, 'the chosen password works')

  assert.deepEqual(errors, [])
  console.log('linked desktop e2e: OK')
} catch (e) {
  console.error(e)
  const win = app.windows()[0]
  if (win) {
    console.error(
      await win
        .locator('.sidebar')
        .innerText()
        .catch(() => '')
    )
    if (process.env.E2E_SHOTS)
      await win.screenshot({ path: join(process.env.E2E_SHOTS, 'linked-failure.png') })
  }
  process.exitCode = 1
} finally {
  await cleanup()
}
