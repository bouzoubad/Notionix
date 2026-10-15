import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { startServer, type NotionixServer } from '../src/server'
import { readConfig } from '../src/config'
import { PAGE_FIELD } from '../../src/shared/collab'
import type { Page, PageSummary } from '../../src/shared/types'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const ADMIN = { email: 'admin@example.com', password: 'motdepasse-admin' }

let dataDir: string
let webDir: string
let running: NotionixServer
const start = async (): Promise<void> => {
  running = await startServer(
    readConfig({
      NOTIONIX_PORT: '0',
      NOTIONIX_HOST: '127.0.0.1',
      NOTIONIX_DATA_DIR: dataDir,
      NOTIONIX_WEB_DIR: webDir,
      NOTIONIX_REMINDER_INTERVAL_MS: '100',
      NOTIONIX_ADMIN_EMAIL: ADMIN.email,
      NOTIONIX_ADMIN_PASSWORD: ADMIN.password
    })
  )
}
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nx-server-'))
  webDir = join(dataDir, 'web')
  mkdirSync(join(webDir, 'assets'), { recursive: true })
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Notionix</title>')
  writeFileSync(join(webDir, 'assets', 'app-1234.js'), 'console.log(1)')
  await start()
})
afterEach(async () => {
  await running?.stop()
})

interface Init {
  method?: string
  token?: string
  cookie?: string
  headers?: Record<string, string>
  json?: unknown
  body?: Uint8Array
}
const call = (path: string, init: Init = {}): Promise<Response> =>
  fetch(running.url + path, {
    method: init.method ?? (init.json || init.body ? 'POST' : 'GET'),
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.cookie ? { Cookie: init.cookie } : {}),
      ...(init.json ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    },
    body: init.json
      ? JSON.stringify(init.json)
      : init.body
        ? new Blob([init.body as Uint8Array<ArrayBuffer>])
        : undefined
  })
const api = async (path: string, init: Init = {}) => {
  const res = await call(path, init)
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    // binary
  }
  return { status: res.status, body }
}
const rpc = async <T>(token: string, method: string, ...args: unknown[]) => {
  const r = await api('/api/rpc', { token, json: { method, args } })
  return { status: r.status, result: r.body.result as T, error: r.body.error }
}
const login = async (email: string, password: string): Promise<string> => {
  const r = await api('/api/login', { json: { email, password } })
  expect(r.status).toBe(200)
  return r.body.token as string
}
const createUser = async (token: string, email: string, role: string): Promise<string> => {
  const r = await api('/api/users', {
    token,
    json: { email, name: email.split('@')[0], role, password: `${role}-password-1` }
  })
  expect(r.status).toBe(201)
  return login(email, `${role}-password-1`)
}

const connect = (name: string, token: string) => {
  const doc = new Y.Doc()
  const failures: string[] = []
  const notices: string[] = []
  const provider = new HocuspocusProvider({
    url: running.url.replace('http', 'ws') + '/collab',
    name,
    token,
    document: doc,
    onAuthenticationFailed: ({ reason }) => failures.push(reason),
    onStateless: ({ payload }) => notices.push(payload)
  })
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  return { doc, provider, synced, failures, notices }
}
const until = async (check: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}
const paragraph = (text: string): Y.XmlElement => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  return p
}
const texts = (doc: Y.Doc): string[] =>
  doc
    .getXmlFragment(PAGE_FIELD)
    .toArray()
    .map((n) => (n instanceof Y.XmlElement ? n.toArray().map(String).join('') : ''))

describe('accounts and sessions', () => {
  it('logs in, rejects wrong passwords and slows down guessing', async () => {
    expect((await api('/api/health')).body.ok).toBe(true)
    expect(
      (await api('/api/login', { json: { email: ADMIN.email, password: 'faux' } })).status
    ).toBe(401)
    expect(
      (await api('/api/login', { json: { email: 'inconnu@example.com', password: 'faux' } })).status
    ).toBe(401)
    const token = await login(ADMIN.email, ADMIN.password)
    expect((await api('/api/me', { token })).body.user).toMatchObject({
      email: ADMIN.email,
      role: 'admin'
    })
    for (let i = 0; i < 8; i++)
      await api('/api/login', { json: { email: 'cible@example.com', password: 'x' } })
    expect(
      (await api('/api/login', { json: { email: 'cible@example.com', password: 'x' } })).status
    ).toBe(429)
  })

  it('lets only admins manage accounts, and ends sessions when a password changes', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const editor = await createUser(admin, 'ed@example.com', 'editor')
    expect((await api('/api/users', { token: editor })).status).toBe(403)
    expect(
      (
        await api('/api/users', {
          token: admin,
          json: { email: 'x@example.com', name: 'x', role: 'editor', password: 'court' }
        })
      ).status
    ).toBe(400)
    const users = (await api('/api/users', { token: admin })).body.users as {
      id: string
      email: string
    }[]
    const ed = users.find((u) => u.email === 'ed@example.com')!
    await api(`/api/users/${ed.id}`, {
      method: 'PATCH',
      token: admin,
      json: { password: 'nouveau-mot-de-passe' }
    })
    expect((await api('/api/me', { token: editor })).status).toBe(401)
    const self = users.find((u) => u.email === ADMIN.email)!
    expect(
      (
        await api(`/api/users/${self.id}`, {
          method: 'PATCH',
          token: admin,
          json: { role: 'editor' }
        })
      ).status
    ).toBe(409)
  })

  it('signs the web client in with an HttpOnly cookie, and refuses cookie-only changes', async () => {
    const res = await call('/api/login', { json: ADMIN })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^notionix_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict/)
    expect(setCookie).not.toContain('Secure')
    const cookie = setCookie.split(';')[0]
    expect((await api('/api/me', { cookie })).status).toBe(200)
    // A form posted from another site carries the cookie but not the client header.
    expect(
      (await api('/api/rpc', { cookie, json: { method: 'pages.create', args: [null] } })).status
    ).toBe(403)
    const ok = await api('/api/rpc', {
      cookie,
      headers: { 'X-Notionix-Client': 'web' },
      json: { method: 'pages.create', args: [null] }
    })
    expect(ok.status).toBe(200)
    const out = await call('/api/logout', {
      method: 'POST',
      cookie,
      headers: { 'X-Notionix-Client': 'web' }
    })
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await api('/api/me', { cookie })).status).toBe(401)
    // Behind IIS terminating HTTPS, the cookie is only sent over HTTPS.
    const proxied = await call('/api/login', {
      json: ADMIN,
      headers: { 'X-Forwarded-Proto': 'https' }
    })
    expect(proxied.headers.get('set-cookie')).toContain('Secure')
  })
})

describe('workspace operations', () => {
  it('runs the app operations, checks arguments and keeps readers read-only', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const reader = await createUser(admin, 'lecteur@example.com', 'reader')
    const page = (await rpc<Page>(admin, 'pages.create', null)).result
    await rpc(admin, 'pages.update', page.id, {
      title: 'Réunion',
      favorite: true,
      content: '{"type":"doc"}'
    })
    const list = (await rpc<PageSummary[]>(reader, 'pages.list')).result
    expect(list).toMatchObject([{ id: page.id, title: 'Réunion', favorite: true }])
    // Content is edited through the page's shared document only.
    expect((await rpc<Page>(admin, 'pages.get', page.id)).result.content).toBe(page.content)
    expect((await rpc(reader, 'pages.update', page.id, { title: 'x' })).status).toBe(403)
    expect((await rpc(admin, 'pages.move', '../x', null, 0)).status).toBe(400)
    expect((await rpc(admin, 'pages.update', 'inconnue', { title: 'x' })).status).toBe(400)
    expect((await rpc(admin, 'process.exit')).status).toBe(404)
    expect((await rpc(admin, 'constructor')).status).toBe(404)

    const db = (await rpc<PageSummary>(admin, 'databases.create', null)).result
    expect((await rpc(admin, 'databases.changePropertyType', db.id, 'p1', 'inconnu')).status).toBe(
      400
    )
    const row = (await rpc<{ id: string }>(admin, 'databases.createRow', db.id, { title: 'Ligne' }))
      .result
    expect((await rpc<{ title: string }>(reader, 'databases.getRow', row.id)).result).toMatchObject(
      {
        row: { title: 'Ligne' }
      }
    )
  })

  it('announces changes to connected clients', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const watcher = connect('workspace:main', await createUser(admin, 'w@example.com', 'editor'))
    await watcher.synced
    await rpc(admin, 'pages.create', null)
    await until(() => watcher.notices.length > 0)
    expect(JSON.parse(watcher.notices[0])).toMatchObject({ type: 'changed' })
    // The channel carries the server's notices only.
    watcher.doc.getMap('x').set('k', 'v')
    const other = connect('workspace:main', admin)
    await other.synced
    expect(other.doc.getMap('x').get('k')).toBeUndefined()
    watcher.provider.destroy()
    other.provider.destroy()
  })
})

describe('access to pages', () => {
  it('keeps private pages private, shares them, and limits guests to what is shared', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const alice = await createUser(admin, 'alice@example.com', 'editor')
    const bob = await createUser(admin, 'bob@example.com', 'editor')
    const guest = await createUser(admin, 'invite@example.com', 'guest')
    const people = (await rpc<{ id: string; email: string }[]>(alice, 'people.list')).result
    const idOf = (email: string): string => people.find((p) => p.email === email)!.id

    const wiki = (await rpc<Page>(alice, 'pages.create', null)).result
    const secret = (await rpc<Page>(alice, 'pages.create', null, 'restricted')).result
    const child = (await rpc<Page>(alice, 'pages.create', secret.id)).result
    expect((await rpc<Page>(alice, 'pages.get', secret.id)).result.level).toBe('full')

    const seen = async (token: string): Promise<string[]> =>
      (await rpc<PageSummary[]>(token, 'pages.list')).result.map((p) => p.id)
    expect(await seen(bob)).toEqual([wiki.id])
    expect(await seen(admin)).toEqual([wiki.id])
    expect(await seen(guest)).toEqual([])
    expect((await rpc(bob, 'pages.get', secret.id)).status).toBe(400)
    expect((await rpc(bob, 'pages.update', child.id, { title: 'x' })).status).toBe(400)
    expect((await rpc(bob, 'pages.create', secret.id)).status).toBe(400)
    expect((await rpc(guest, 'pages.create', null)).status).toBe(403)
    // Search does not reveal private pages.
    await rpc(alice, 'pages.update', secret.id, { title: 'Budget confidentiel' })
    expect((await rpc<unknown[]>(bob, 'pages.search', 'confidentiel')).result).toEqual([])

    // Sharing the private page: bob may read it and its sub-page, not edit.
    expect(
      (await rpc(bob, 'pages.setShare', secret.id, idOf('bob@example.com'), 'read')).status
    ).toBe(400)
    await rpc(alice, 'pages.setShare', secret.id, idOf('bob@example.com'), 'read')
    expect((await seen(bob)).sort()).toEqual([wiki.id, secret.id, child.id].sort())
    expect((await rpc(bob, 'pages.update', child.id, { title: 'x' })).status).toBe(403)
    expect((await rpc(bob, 'pages.setAccess', secret.id, 'workspace')).status).toBe(403)

    // A guest invited on the sub-page only sees that page, and may edit it.
    await rpc(alice, 'pages.setShare', child.id, idOf('invite@example.com'), 'edit')
    expect(await seen(guest)).toEqual([child.id])
    expect((await rpc(guest, 'pages.update', child.id, { title: 'Relu' })).status).toBe(200)
    expect((await rpc(guest, 'pages.get', wiki.id)).status).toBe(400)
    expect(
      (await rpc<PageSummary[]>(alice, 'pages.list')).result.find((p) => p.id === child.id)
        ?.updatedBy
    ).toBe(idOf('invite@example.com'))

    // Opening the page to the workspace.
    await rpc(alice, 'pages.setAccess', secret.id, 'workspace')
    expect((await rpc<Page>(admin, 'pages.get', secret.id)).result.level).toBe('full')
    await rpc(alice, 'pages.setSpace', wiki.id, true)
    expect((await rpc<Page>(bob, 'pages.get', wiki.id)).result.isSpace).toBe(true)
  })

  it('refuses the shared document of a page one cannot see, and opens it read-only for readers', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const secret = (await rpc<Page>(admin, 'pages.create', null, 'restricted')).result
    const open = (await rpc<Page>(admin, 'pages.create', null)).result
    const bob = await createUser(admin, 'bob@example.com', 'editor')
    const denied = connect(`page:${secret.id}`, bob)
    await until(() => denied.failures.length > 0)
    const reader = connect(`page:${open.id}`, await createUser(admin, 'r@example.com', 'reader'))
    await reader.synced
    reader.doc.getXmlFragment(PAGE_FIELD).insert(0, [paragraph('tentative')])
    const editor = connect(`page:${open.id}`, admin)
    await editor.synced
    await new Promise((r) => setTimeout(r, 200))
    expect(texts(editor.doc)).not.toContain('tentative')
    for (const c of [denied, reader, editor]) c.provider.destroy()
  })

  it('exports only the pages one can read', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const bob = await createUser(admin, 'bob@example.com', 'editor')
    const visible = (await rpc<Page>(admin, 'pages.create', null)).result
    await rpc(admin, 'pages.update', visible.id, { title: 'Publique' })
    const secret = (await rpc<Page>(admin, 'pages.create', null, 'restricted')).result
    await rpc(admin, 'pages.update', secret.id, { title: 'Secrète' })
    const res = await call('/api/transfer/export', { token: bob })
    const zip = Buffer.from(await res.arrayBuffer())
    expect(res.headers.get('x-notionix-pages')).toBe('1')
    expect(zip.includes(Buffer.from('Publique'))).toBe(true)
    expect(zip.includes(Buffer.from('Secrète'))).toBe(false)
    expect((await call(`/api/transfer/export?page=${secret.id}`, { token: bob })).status).toBe(400)
  })
})

describe('groups and workspaces', () => {
  it('shares a page with a group, following its members', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const alice = await createUser(admin, 'alice@example.com', 'editor')
    const bob = await createUser(admin, 'bob@example.com', 'editor')
    const carol = await createUser(admin, 'carol@example.com', 'editor')
    const people = (await rpc<{ id: string; email: string }[]>(alice, 'people.list')).result
    const idOf = (email: string): string => people.find((p) => p.email === email)!.id

    expect((await api('/api/groups', { token: alice, json: { name: 'Produit' } })).status).toBe(403)
    const created = await api('/api/groups', {
      token: admin,
      json: { name: 'Produit', memberIds: [idOf('bob@example.com'), 'inconnu'] }
    })
    expect(created.status).toBe(201)
    const group = created.body.group as { id: string; memberIds: string[] }
    expect(group.memberIds).toEqual([idOf('bob@example.com')])

    const secret = (await rpc<Page>(alice, 'pages.create', null, 'restricted')).result
    expect((await rpc(alice, 'pages.setShare', secret.id, group.id, 'edit')).status).toBe(200)
    expect((await rpc<Page>(bob, 'pages.get', secret.id)).result.level).toBe('edit')
    expect((await rpc(carol, 'pages.get', secret.id)).status).toBe(400)
    // Bob heard about it.
    expect((await rpc<unknown[]>(bob, 'inbox.list')).result).toHaveLength(1)

    // Members change: the access follows.
    await api(`/api/groups/${group.id}`, {
      token: admin,
      method: 'PATCH',
      json: { memberIds: [idOf('carol@example.com')] }
    })
    expect((await rpc(bob, 'pages.get', secret.id)).status).toBe(400)
    expect((await rpc<Page>(carol, 'pages.get', secret.id)).result.level).toBe('edit')

    // Deleting the group ends its shares.
    await api(`/api/groups/${group.id}`, { token: admin, method: 'DELETE' })
    expect((await rpc(carol, 'pages.get', secret.id)).status).toBe(400)
    expect((await rpc<unknown[]>(alice, 'pages.shares', secret.id)).result).toEqual([])
  })

  it('keeps the pages of each workspace apart, open to its members', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const alice = await createUser(admin, 'alice@example.com', 'editor')
    const bob = await createUser(admin, 'bob@example.com', 'editor')
    const people = (await rpc<{ id: string; email: string }[]>(admin, 'people.list')).result
    const idOf = (email: string): string => people.find((p) => p.email === email)!.id

    const created = await api('/api/workspaces', {
      token: admin,
      json: { name: 'Projet X', icon: '🚀', memberIds: [idOf('alice@example.com')] }
    })
    expect(created.status).toBe(201)
    const ws = (created.body.workspace as { id: string }).id
    const inWs = { 'X-Notionix-Workspace': ws }
    const wsRpc = async <T>(token: string, method: string, ...args: unknown[]) => {
      const r = await api('/api/rpc', { token, headers: inWs, json: { method, args } })
      return { status: r.status, result: r.body.result as T }
    }

    const ids = async (token: string): Promise<string[]> =>
      ((await api('/api/workspaces', { token })).body.workspaces as { id: string }[]).map(
        (w) => w.id
      )
    expect(await ids(alice)).toEqual(['main', ws])
    expect(await ids(bob)).toEqual(['main'])

    const page = (await wsRpc<Page>(alice, 'pages.create', null)).result
    await wsRpc(alice, 'pages.update', page.id, { title: 'Plan secret' })
    expect((await wsRpc<PageSummary[]>(alice, 'pages.list')).result.map((p) => p.id)).toEqual([
      page.id
    ])
    // Not in the main workspace, and closed to non-members.
    expect((await rpc<PageSummary[]>(alice, 'pages.list')).result).toEqual([])
    expect((await wsRpc(bob, 'pages.list')).status).toBe(404)
    // People of the workspace: its members (and the administrators).
    expect(
      (await wsRpc<{ email: string }[]>(alice, 'people.list')).result.map((p) => p.email).sort()
    ).toEqual([ADMIN.email, 'alice@example.com'])

    // Its shared document is found, for members only.
    const doc = connect(`page:${page.id}`, alice)
    await doc.synced
    const intruder = connect(`page:${page.id}`, bob)
    await until(() => intruder.failures.length > 0)
    doc.provider.destroy()
    intruder.provider.destroy()

    // Images are stored in the workspace and served to its members.
    const saved = await call('/api/assets?name=a.png', { token: alice, headers: inWs, body: PNG })
    const { src } = (await saved.json()) as { src: string }
    const name = src.replace('notionix-asset://file/', '')
    expect((await call(`/api/assets/${name}`, { token: alice })).status).toBe(200)
    expect((await call(`/api/assets/${name}`, { token: bob })).status).toBe(404)

    // Adding bob as a member opens it to him.
    await api(`/api/workspaces/${ws}`, {
      token: admin,
      method: 'PATCH',
      json: { name: 'Projet X2', memberIds: [idOf('alice@example.com'), idOf('bob@example.com')] }
    })
    expect((await wsRpc<PageSummary[]>(bob, 'pages.list')).result).toHaveLength(1)
    expect((await api('/api/workspaces', { token: bob })).body.workspaces).toMatchObject([
      { id: 'main' },
      { id: ws, name: 'Projet X2', icon: '🚀' }
    ])
  })
})

describe('comments, mentions and notifications', () => {
  it('notifies mentioned people and followers, and lets each person handle their comments', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const alice = await createUser(admin, 'alice@example.com', 'editor')
    const bob = await createUser(admin, 'bob@example.com', 'editor')
    const reader = await createUser(admin, 'lecteur@example.com', 'reader')
    const people = (await rpc<{ id: string; email: string }[]>(alice, 'people.list')).result
    const idOf = (email: string): string => people.find((p) => p.email === email)!.id
    const page = (await rpc<Page>(alice, 'pages.create', null)).result
    await rpc(alice, 'pages.update', page.id, { title: 'Plan' })
    const secret = (await rpc<Page>(alice, 'pages.create', null, 'restricted')).result

    const watcher = connect('workspace:main', bob)
    await watcher.synced
    const first = await rpc<{ id: string; threadId: string }>(bob, 'comments.add', page.id, {
      threadId: 'fil-1',
      body: 'Tu peux relire @Lecteur ?',
      mentions: [idOf('lecteur@example.com'), 'inconnu'],
      quote: 'le budget'
    })
    expect(first.status).toBe(200)
    expect(first.result.threadId).toBe('fil-1')
    const inbox = async (token: string) =>
      (
        await rpc<{ id: string; kind: string; text: string; readAt: number | null }[]>(
          token,
          'inbox.list'
        )
      ).result
    expect((await inbox(reader)).map((i) => i.kind)).toEqual(['mention'])
    expect((await inbox(alice)).map((i) => i.kind)).toEqual(['comment'])
    expect(await inbox(bob)).toEqual([])
    // Readers comment; the thread's author hears about it, live.
    await rpc(reader, 'comments.add', page.id, { threadId: 'fil-1', body: 'Fait.' })
    await until(() => watcher.notices.some((n) => JSON.parse(n).type === 'inbox'))
    expect((await inbox(bob))[0].text).toContain('Fait.')
    // Mentioning someone who cannot read the page notifies nobody.
    await rpc(alice, 'comments.add', secret.id, {
      body: '@bob',
      mentions: [idOf('bob@example.com')]
    })
    expect((await inbox(bob)).length).toBe(1)
    expect((await rpc(bob, 'comments.list', secret.id)).status).toBe(400)

    const list = (await rpc<{ id: string; authorId: string }[]>(alice, 'comments.list', page.id))
      .result
    expect(list).toHaveLength(2)
    expect((await rpc(alice, 'comments.update', first.result.id, 'x', [])).status).toBe(403)
    expect((await rpc(alice, 'comments.remove', list[1].id)).status).toBe(200)
    expect((await rpc(reader, 'comments.remove', first.result.id)).status).toBe(403)
    await rpc(bob, 'comments.resolve', 'fil-1', true)
    expect(
      (await rpc<{ resolvedAt: number | null }[]>(bob, 'comments.list', page.id)).result[0]
        .resolvedAt
    ).not.toBeNull()

    await rpc(bob, 'inbox.markRead', null)
    expect((await inbox(bob)).every((i) => i.readAt !== null)).toBe(true)
    const activity = (await rpc<{ kind: string }[]>(bob, 'inbox.activity')).result.map(
      (a) => a.kind
    )
    expect(activity).toContain('commented')
    expect(activity).toContain('created')
    watcher.provider.destroy()
  })

  it('notifies people mentioned in a page and sends reminders still in the page', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const bob = await createUser(admin, 'bob@example.com', 'editor')
    const bobId = (await rpc<{ id: string; email: string }[]>(admin, 'people.list')).result.find(
      (p) => p.email === 'bob@example.com'
    )!.id
    const page = (await rpc<Page>(admin, 'pages.create', null)).result
    const editor = connect(`page:${page.id}`, admin)
    await editor.synced
    const p = new Y.XmlElement('paragraph')
    const mention = (attrs: Record<string, string>): Y.XmlElement => {
      const m = new Y.XmlElement('mention')
      for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v)
      return m
    }
    p.insert(0, [
      mention({ kind: 'user', id: bobId, label: 'bob' }),
      mention({ kind: 'date', id: 'rappel1', label: 'demain', date: '2026-01-01T09:00' })
    ])
    editor.doc.getXmlFragment(PAGE_FIELD).insert(1, [p])
    await new Promise((r) => setTimeout(r, 200))
    await rpc(admin, 'pages.search', 'bob')
    const items = (await rpc<{ kind: string }[]>(bob, 'inbox.list')).result
    expect(items.map((i) => i.kind)).toEqual(['mention'])

    // A reminder fires once, only while its date is in the page.
    await rpc(bob, 'reminders.set', page.id, 'rappel1', Date.now() - 1000, 'Rappel : réunion')
    await rpc(bob, 'reminders.set', page.id, 'disparu', Date.now() - 1000, 'Rappel : supprimé')
    await until(() => true)
    await new Promise((r) => setTimeout(r, 400))
    const after = (await rpc<{ kind: string; text: string }[]>(bob, 'inbox.list')).result
    expect(after.filter((i) => i.kind === 'reminder').map((i) => i.text)).toEqual([
      'Rappel : réunion'
    ])
    editor.provider.destroy()
  })
})

describe('API tokens, publishing and exports', () => {
  it('lets scripts act with a personal token, until it is revoked', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const created = await api('/api/tokens', { token: admin, json: { name: 'Script' } })
    expect(created.status).toBe(201)
    const token = created.body.token as string
    expect(token.startsWith('nxk_')).toBe(true)
    const page = await rpc<Page>(token, 'pages.create', null)
    expect(page.status).toBe(200)
    const list = (await api('/api/tokens', { token: admin })).body.tokens as {
      id: string
      lastUsedAt: number
    }[]
    expect(list[0].lastUsedAt).toBeGreaterThan(0)
    await api(`/api/tokens/${list[0].id}`, { method: 'DELETE', token: admin })
    expect((await rpc(token, 'pages.list')).status).toBe(401)
  })

  it('creates pages from templates with checked content', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const content = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Modèle' }] }]
    })
    const page = await rpc<Page>(admin, 'pages.createWith', null, {
      title: 'Réunion',
      icon: '📝',
      content
    })
    expect(page.result).toMatchObject({ title: 'Réunion', icon: '📝', content })
    const bad = await rpc(admin, 'pages.createWith', null, {
      content: '{"type":"doc","content":[{"type":"inconnu"}]}'
    })
    expect(bad.status).toBe(400)
  })

  it('serves a published page and its sub-pages to anyone with the link, and nothing else', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const name = `${createHash('sha256').update(PNG).digest('hex')}.png`
    await api(`/api/assets/${name}`, { method: 'PUT', token: admin, body: PNG })
    const page = (
      await rpc<Page>(admin, 'pages.createWith', null, {
        title: 'Publique',
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'image', attrs: { src: `notionix-asset://file/${name}` } }]
        })
      })
    ).result
    const child = (await rpc<Page>(admin, 'pages.create', page.id)).result
    const other = (await rpc<Page>(admin, 'pages.create', null)).result
    const published = (await rpc<PageSummary>(admin, 'pages.publish', page.id, true)).result
    const link = published.publicToken!
    expect(link.length).toBeGreaterThanOrEqual(16)
    const seen = await api(`/api/public/${link}`)
    expect(seen.body.page).toMatchObject({ title: 'Publique', children: [{ id: child.id }] })
    expect((await api(`/api/public/${link}/pages/${child.id}`)).status).toBe(200)
    expect((await api(`/api/public/${link}/pages/${other.id}`)).status).toBe(404)
    expect((await call(`/api/public/${link}/assets/${name}`)).status).toBe(200)
    await rpc(admin, 'pages.publish', page.id, false)
    expect((await api(`/api/public/${link}`)).status).toBe(404)
    expect((await call(`/api/public/${link}/assets/${name}`)).status).toBe(404)
  })

  it('exports pages as HTML', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const page = (
      await rpc<Page>(admin, 'pages.createWith', null, {
        title: 'Rapport',
        content: JSON.stringify({
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Bilan' }] }
          ]
        })
      })
    ).result
    const res = await call(`/api/transfer/export?format=html&page=${page.id}`, { token: admin })
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('<h2>Bilan</h2>')
    expect(html).toContain('<title>Rapport</title>')
  })
})

describe('public forms', () => {
  it('lets anyone answer a shared form, through its fields only', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const db = (await rpc<PageSummary>(admin, 'databases.create', null)).result
    const base = (
      await rpc<{ schema: { properties: unknown[]; views: unknown[] } }>(
        admin,
        'databases.get',
        db.id
      )
    ).result.schema
    const token = 'abcdefghij0123456789xyz0'
    await rpc(admin, 'databases.updateSchema', db.id, {
      ...base,
      properties: [
        ...base.properties,
        { id: 'mail', name: 'E-mail', type: 'email' },
        { id: 'secret', name: 'Note interne', type: 'text' }
      ],
      views: [
        ...base.views,
        {
          id: 'f',
          name: 'Demande',
          type: 'form',
          filters: [],
          filterMode: 'and',
          sorts: [],
          hidden: ['secret'],
          formToken: token
        }
      ]
    })
    const form = await api(`/api/form/${token}`)
    expect(form.body.form).toMatchObject({ title: 'Demande' })
    expect((form.body.form as { fields: { id: string }[] }).fields.map((f) => f.id)).toEqual([
      'title',
      'mail'
    ])
    const sent = await api(`/api/form/${token}`, {
      json: { title: 'Nouvelle demande', mail: 'a@b.fr', secret: 'x' }
    })
    expect(sent.status).toBe(201)
    const rows = (
      await rpc<{ rows: { title: string; properties: Record<string, unknown> }[] }>(
        admin,
        'databases.get',
        db.id
      )
    ).result.rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Nouvelle demande', properties: { mail: 'a@b.fr' } })
    expect(rows[0].properties.secret).toBeUndefined()
    expect((await api('/api/form/inconnuinconnuinconnu')).status).toBe(404)
  })
})

describe('feedback', () => {
  it('lets everyone report, and administrators follow up', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const marie = await createUser(admin, 'marie@example.com', 'editor')
    const paul = await createUser(admin, 'paul@example.com', 'reader')
    const sent = await api('/api/feedback', {
      token: marie,
      json: {
        kind: 'bug',
        title: 'La recherche plante',
        body: 'Avec un accent',
        context: { page: 'x' }
      }
    })
    expect(sent.status).toBe(201)
    const id = (sent.body.feedback as { id: string }).id
    await api('/api/feedback', { token: paul, json: { kind: 'idea', title: 'Mode sombre forcé' } })
    expect(
      (await api('/api/feedback', { token: marie, json: { kind: 'bug', title: '' } })).status
    ).toBe(400)

    // Each person sees their own; administrators see everything and are notified.
    expect(((await api('/api/feedback', { token: marie })).body.feedback as unknown[]).length).toBe(
      1
    )
    expect(((await api('/api/feedback', { token: admin })).body.feedback as unknown[]).length).toBe(
      2
    )
    const adminInbox = (await rpc<{ kind: string; text: string }[]>(admin, 'inbox.list')).result
    expect(adminInbox.filter((i) => i.kind === 'feedback')).toHaveLength(2)

    expect(
      (
        await api(`/api/feedback/${id}`, {
          method: 'PATCH',
          token: marie,
          json: { status: 'done' }
        })
      ).status
    ).toBe(403)
    const answered = await api(`/api/feedback/${id}`, {
      method: 'PATCH',
      token: admin,
      json: { status: 'in_progress', reply: 'Merci, corrigé bientôt.' }
    })
    expect(answered.body.feedback).toMatchObject({
      status: 'in_progress',
      reply: 'Merci, corrigé bientôt.'
    })
    const marieInbox = (await rpc<{ kind: string; text: string }[]>(marie, 'inbox.list')).result
    expect(marieInbox[0].text).toContain('En cours')
    await api(`/api/feedback/${id}`, { method: 'DELETE', token: admin })
    expect(((await api('/api/feedback', { token: admin })).body.feedback as unknown[]).length).toBe(
      1
    )
  })
})

describe('shared pages', () => {
  it('starts from the stored content, syncs editors, keeps readers read-only and writes content back', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const page = (await rpc<Page>(admin, 'pages.create', null)).result
    const a = connect(`page:${page.id}`, await createUser(admin, 'a@example.com', 'editor'))
    const b = connect(`page:${page.id}`, await createUser(admin, 'b@example.com', 'editor'))
    const r = connect(`page:${page.id}`, await createUser(admin, 'r@example.com', 'reader'))
    await Promise.all([a.synced, b.synced, r.synced])
    // Seeded from the page's stored content: one empty paragraph.
    expect(texts(a.doc)).toEqual([''])

    a.doc.getXmlFragment(PAGE_FIELD).insert(1, [paragraph('Écrit par A')])
    await until(() => texts(b.doc).includes('Écrit par A') && texts(r.doc).includes('Écrit par A'))
    r.doc.getXmlFragment(PAGE_FIELD).insert(0, [paragraph('écrit par le lecteur')])
    b.doc.getXmlFragment(PAGE_FIELD).insert(2, [paragraph('Écrit par B')])
    await until(() => texts(a.doc).includes('Écrit par B'))
    expect(texts(a.doc)).not.toContain('écrit par le lecteur')

    // Search and duplication read the content being edited.
    const hits = (await rpc<{ id: string }[]>(admin, 'pages.search', 'Écrit')).result
    expect(hits.map((h) => h.id)).toEqual([page.id])
    const copy = (await rpc<Page>(admin, 'pages.duplicate', page.id)).result
    expect(copy.content).toContain('Écrit par B')

    for (const c of [a, b, r]) c.provider.destroy()
    await running.stop()
    await start()
    const again = connect(`page:${page.id}`, await login('a@example.com', 'editor-password-1'))
    await again.synced
    expect(texts(again.doc)).toEqual(['', 'Écrit par A', 'Écrit par B'])
    again.provider.destroy()
  })

  it('keeps the history of a shared page and restores a version to every editor', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const page = (await rpc<Page>(admin, 'pages.create', null)).result
    const a = connect(`page:${page.id}`, admin)
    await a.synced
    a.doc.getXmlFragment(PAGE_FIELD).insert(1, [paragraph('Première version')])
    // Search reads (and saves) the content being edited.
    await until(() => texts(a.doc).includes('Première version'))
    await rpc(admin, 'pages.search', 'Première')
    const versions = (
      await rpc<{ id: number; authors: string[] }[]>(admin, 'pages.versions', page.id)
    ).result
    expect(versions).toHaveLength(1)
    // An hour later: the next changes start a new version.
    running.workspace.db.prepare('UPDATE page_versions SET created_at = created_at - 3600000').run()
    a.doc.getXmlFragment(PAGE_FIELD).delete(0, 2)
    a.doc.getXmlFragment(PAGE_FIELD).insert(0, [paragraph('Tout réécrit')])
    // Changes still on their way when restoring would be kept, like any concurrent edit.
    await new Promise((r) => setTimeout(r, 300))
    expect((await rpc(admin, 'pages.restoreVersion', page.id, versions[0].id)).status).toBe(200)
    expect(
      (await rpc<unknown[]>(admin, 'pages.versions', page.id)).result.length
    ).toBeGreaterThanOrEqual(3)
    await until(
      () => texts(a.doc).includes('Première version') && !texts(a.doc).includes('Tout réécrit')
    )
    a.provider.destroy()
  })

  it('refuses bad tokens, unknown documents and deleted pages', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const page = (await rpc<Page>(admin, 'pages.create', null)).result
    const bad = connect(`page:${page.id}`, 'jeton-invalide')
    const odd = connect('../etc/passwd', admin)
    const missing = connect('page:inconnue', admin)
    await until(
      () => bad.failures.length > 0 && odd.failures.length > 0 && missing.failures.length > 0
    )

    const editor = connect(`page:${page.id}`, admin)
    await editor.synced
    editor.doc.getXmlFragment(PAGE_FIELD).insert(0, [paragraph('bientôt supprimé')])
    await until(() => running.db.prepare('SELECT 1 FROM documents').get() !== undefined)
    await rpc(admin, 'pages.deleteForever', page.id)
    // Its editors are disconnected; the document is not stored again.
    await new Promise((r) => setTimeout(r, 300))
    expect(running.db.prepare('SELECT name FROM documents').all()).toEqual([])
    for (const c of [bad, odd, missing, editor]) c.provider.destroy()
  })
})

describe('images, transfer and web client', () => {
  it('stores images under their own hash only, for editors', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const reader = await createUser(admin, 'lecteur@example.com', 'reader')
    const name = `${createHash('sha256').update(PNG).digest('hex')}.png`
    expect(
      (await api(`/api/assets/${name}`, { method: 'PUT', token: reader, body: PNG })).status
    ).toBe(403)
    expect(
      (await api(`/api/assets/${'0'.repeat(64)}.png`, { method: 'PUT', token: admin, body: PNG }))
        .status
    ).toBe(400)
    expect(
      (await api(`/api/assets/${name}`, { method: 'PUT', token: admin, body: PNG })).status
    ).toBe(200)
    expect((await api(`/api/assets/${name}`)).status).toBe(401)
    const res = await call(`/api/assets/${name}`, { token: reader })
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG)
    // The web client lets the server name the image.
    const posted = await api('/api/assets?name=photo.png', { token: admin, body: PNG })
    expect(posted.body.src).toBe(`notionix-asset://file/${name}`)
    expect(
      (await api('/api/assets?name=x.png', { token: admin, body: Buffer.from('pas une image') }))
        .status
    ).toBe(400)
  })

  it('exports Markdown as a download', async () => {
    const admin = await login(ADMIN.email, ADMIN.password)
    const page = (await rpc<Page>(admin, 'pages.create', null)).result
    await rpc(admin, 'pages.update', page.id, { title: 'Compte rendu' })
    const res = await call(`/api/transfer/export?page=${page.id}`, { token: admin })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('Compte rendu.md')}`
    )
    expect(res.headers.get('x-notionix-pages')).toBe('1')
    expect(await res.text()).toContain('# Compte rendu')
  })

  it('serves the web client with a strict policy, and its index for app paths', async () => {
    const index = await call('/')
    expect(index.status).toBe(200)
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(await index.text()).toContain('<title>Notionix</title>')
    expect((await call('/une/page')).status).toBe(200)
    const script = await call('/assets/app-1234.js')
    expect(script.headers.get('cache-control')).toContain('immutable')
    expect((await call('/%2e%2e/%2e%2e/etc/passwd')).headers.get('content-type')).toContain(
      'text/html'
    )
    expect((await api('/api/inconnu')).status).toBe(404)
  })
})
