import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { startServer, type NotionixServer } from '../src/server'
import { readConfig } from '../src/config'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const ADMIN = { email: 'admin@example.com', password: 'motdepasse-admin' }

let dataDir: string
let running: NotionixServer
const start = async (): Promise<void> => {
  running = await startServer(
    readConfig({
      NOTIONIX_PORT: '0',
      NOTIONIX_HOST: '127.0.0.1',
      NOTIONIX_DATA_DIR: dataDir,
      NOTIONIX_ADMIN_EMAIL: ADMIN.email,
      NOTIONIX_ADMIN_PASSWORD: ADMIN.password
    })
  )
}
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nx-server-'))
  await start()
})
afterEach(async () => {
  await running?.stop()
})

const api = async (path: string, init: { method?: string; token?: string; json?: unknown; body?: Uint8Array } = {}) => {
  const res = await fetch(running.url + path, {
    method: init.method ?? (init.json || init.body ? 'POST' : 'GET'),
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.json ? { 'Content-Type': 'application/json' } : {})
    },
    body: init.json ? JSON.stringify(init.json) : init.body
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    // binary
  }
  return { status: res.status, body }
}
const login = async (email: string, password: string): Promise<string> => {
  const r = await api('/api/login', { json: { email, password } })
  expect(r.status).toBe(200)
  return r.body.token as string
}
const createUser = async (token: string, email: string, role: string): Promise<string> => {
  const r = await api('/api/users', { token, json: { email, name: email.split('@')[0], role, password: `${role}-password-1` } })
  expect(r.status).toBe(201)
  return login(email, `${role}-password-1`)
}

const connect = (name: string, token: string) => {
  const doc = new Y.Doc()
  const failures: string[] = []
  const provider = new HocuspocusProvider({
    url: running.url.replace('http', 'ws'),
    name,
    token,
    document: doc,
    onAuthenticationFailed: ({ reason }) => failures.push(reason)
  })
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  return { doc, provider, synced, failures }
}
const until = async (check: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('accounts and sessions', () => {
  it('logs in, rejects wrong passwords and slows down guessing', async () => {
    expect((await api('/api/health')).body.ok).toBe(true)
    expect((await api('/api/login', { json: { email: ADMIN.email, password: 'faux' } })).status).toBe(401)
    expect((await api('/api/login', { json: { email: 'inconnu@example.com', password: 'faux' } })).status).toBe(401)
    const token = await login(ADMIN.email, ADMIN.password)
    expect((await api('/api/me', { token })).body.user).toMatchObject({ email: ADMIN.email, role: 'admin' })
    for (let i = 0; i < 8; i++) await api('/api/login', { json: { email: 'cible@example.com', password: 'x' } })
    expect((await api('/api/login', { json: { email: 'cible@example.com', password: 'x' } })).status).toBe(429)
  })

  it('lets only admins manage accounts, and ends sessions when a password changes', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const editor = await createUser(admin, 'ed@example.com', 'editor')
    expect((await api('/api/users', { token: editor })).status).toBe(403)
    expect((await api('/api/users', { token: admin, json: { email: 'x@example.com', name: 'x', role: 'editor', password: 'court' } })).status).toBe(400)
    const users = (await api('/api/users', { token: admin })).body.users as { id: string; email: string }[]
    const ed = users.find((u) => u.email === 'ed@example.com')!
    await api(`/api/users/${ed.id}`, { method: 'PATCH', token: admin, json: { password: 'nouveau-mot-de-passe' } })
    expect((await api('/api/me', { token: editor })).status).toBe(401)
    const self = users.find((u) => u.email === ADMIN.email)!
    expect((await api(`/api/users/${self.id}`, { method: 'PATCH', token: admin, json: { role: 'editor' } })).status).toBe(409)
  })
})

describe('real-time sync', () => {
  it('syncs editors, keeps readers read-only, persists, and refuses bad tokens', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const a = connect('workspace:main', await createUser(admin, 'a@example.com', 'editor'))
    const b = connect('workspace:main', await createUser(admin, 'b@example.com', 'editor'))
    const r = connect('workspace:main', await createUser(admin, 'r@example.com', 'reader'))
    await Promise.all([a.synced, b.synced, r.synced])

    a.doc.getMap('pages').set('p1', 'Page de A')
    await until(() => b.doc.getMap('pages').get('p1') === 'Page de A' && r.doc.getMap('pages').get('p1') === 'Page de A')

    r.doc.getMap('pages').set('p2', 'écrit par le lecteur')
    b.doc.getMap('pages').set('p3', 'Page de B')
    await until(() => a.doc.getMap('pages').get('p3') === 'Page de B')
    expect(a.doc.getMap('pages').get('p2')).toBeUndefined()

    const bad = connect('workspace:main', 'jeton-invalide')
    await until(() => bad.failures.length > 0)
    const odd = connect('../etc/passwd', admin)
    await until(() => odd.failures.length > 0)
    for (const c of [a, b, r, bad, odd]) c.provider.destroy()

    await running.stop()
    await start()
    const again = connect('workspace:main', await login('a@example.com', 'editor-password-1'))
    await again.synced
    expect(again.doc.getMap('pages').toJSON()).toEqual({ p1: 'Page de A', p3: 'Page de B' })
    again.provider.destroy()
  })
})

describe('images', () => {
  it('stores images under their own hash only, for editors', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const reader = await createUser(admin, 'lecteur@example.com', 'reader')
    const name = `${createHash('sha256').update(PNG).digest('hex')}.png`
    expect((await api(`/api/assets/${name}`, { method: 'PUT', token: reader, body: PNG })).status).toBe(403)
    expect((await api(`/api/assets/${'0'.repeat(64)}.png`, { method: 'PUT', token: admin, body: PNG })).status).toBe(400)
    expect((await api(`/api/assets/${name}`, { method: 'PUT', token: admin, body: PNG })).status).toBe(200)
    expect((await api(`/api/assets/${name}`)).status).toBe(401)
    const res = await fetch(`${running.url}/api/assets/${name}`, { headers: { Authorization: `Bearer ${reader}` } })
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG)
  })
})
