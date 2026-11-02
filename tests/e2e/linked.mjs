// E2E of the desktop app linked to a Notionix server: private pages stay on this
// computer, the team's go to the server; without network the team pages kept
// here still open and can be edited, and what was written merges on reconnection.
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
  const privateSection = win.getByRole('tree', { name: 'Privé (cet ordinateur)' })
  await privateSection.waitFor()
  assert.equal(await win.getByRole('button', { name: 'Se déconnecter' }).count(), 1)

  // A private page, kept on this computer
  await privateSection.locator('.tree-title').hover()
  await privateSection.getByRole('button', { name: 'Nouvelle page' }).click()
  await win.locator('.local-badge').waitFor()
  await win.locator('.page-title').fill('Secret local')
  await win.locator('.page-title').press('Enter')
  await win.keyboard.type('Rien de ceci ne quitte le Mac')
  await win.locator('.local-badge').waitFor()
  await privateSection.getByText('Secret local').waitFor()

  // A team page, on the server (created there: wait for it to open)
  await win.getByRole('button', { name: '+ Nouvelle page' }).click()
  await win.waitForFunction(
    () =>
      document.querySelector('.page-title')?.value === '' && !document.querySelector('.local-badge')
  )
  await win.locator('.page-title').fill('Page équipe')
  await win.locator('.page-title').press('Enter')
  await win.keyboard.type('Bonjour équipe')
  assert.equal(await win.locator('.local-badge').count(), 0)
  await win.getByRole('tree', { name: 'Espace d’équipe' }).getByText('Page équipe').waitFor()

  let team = null
  await until(async () => {
    const pages = await call('pages.list')
    team = pages.find((p) => p.title === 'Page équipe')
    if (!team) return false
    const page = await call('pages.get', team.id)
    return page.content.includes('Bonjour équipe')
  }, 'team page stored by the server')
  const titles = (await call('pages.list')).map((p) => p.title)
  assert.ok(!titles.includes('Secret local'), 'the private page never reaches the server')
  assert.equal((await call('pages.search', 'Secret')).length, 0)

  // Without network: the team page opens from what was kept, and stays editable
  await stopServer()
  await win.locator('.offline-banner').waitFor()
  await win.reload()
  await win.getByRole('tree', { name: 'Espace d’équipe' }).getByText('Page équipe').click()
  await win.locator('.editor', { hasText: 'Bonjour équipe' }).waitFor()
  await win.locator('.editor p', { hasText: 'Bonjour équipe' }).click()
  await win.keyboard.press('End')
  await win.keyboard.type(' et hors ligne')
  await win.waitForTimeout(800)
  // The private page too
  await privateSection.getByText('Secret local').click()
  await win.locator('.editor', { hasText: 'Rien de ceci ne quitte le Mac' }).waitFor()

  // Network back: what was written offline reaches the server
  await startServer()
  token = null
  await win.locator('.offline-banner').waitFor({ state: 'detached', timeout: 30_000 })
  await until(
    async () => (await call('pages.get', team.id)).content.includes('Bonjour équipe et hors ligne'),
    'offline edit merged on the server',
    30_000
  )
  assert.ok(!(await call('pages.list')).some((p) => p.title === 'Secret local'))

  // Signing out keeps the private pages and forgets the server's
  await win.getByRole('button', { name: 'Se déconnecter' }).click()
  await win.getByRole('button', { name: 'Se connecter à un serveur' }).waitFor()
  await win.locator('.sidebar').getByText('Secret local').waitFor()
  assert.equal(await win.locator('.sidebar').getByText('Page équipe').count(), 0)

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
  await win
    .getByRole('tree', { name: 'Privé (cet ordinateur)' })
    .getByText('Secret local')
    .waitFor()
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
