import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { cacheKeyOf, ServerCache } from '../src/core/serverCache'
import { ServerLink, type SecretBox } from '../src/main/server'

const secrets: SecretBox = {
  seal: (text) => `sealed:${[...text].reverse().join('')}`,
  open: (sealed) => [...sealed.slice(7)].reverse().join('')
}
const user = { id: 'u1', email: 'moi@example.com', name: 'Moi', role: 'editor' as const }
const ACTIVATION = 'cle-activation-0123456789abcdef'

/** A fake server: answers by path, records each request; `down` makes it unreachable. */
interface FakeServer {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  requests: { url: string; init: RequestInit }[]
  state: { down: boolean; hang: boolean; gateway: boolean; expired: boolean; title: string }
}

function fakeServer(): FakeServer {
  const requests: { url: string; init: RequestInit }[] = []
  const state = { down: false, hang: false, gateway: false, expired: false, title: 'Accueil' }
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (state.down) throw new TypeError('net::ERR_CONNECTION_REFUSED')
    requests.push({ url, init })
    // No VPN: nothing answers, nothing refuses; only giving up ends the request.
    if (state.hang)
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('net::ERR_ABORTED')))
      })
    // A proxy whose server is not running.
    if (state.gateway) return new Response('Bad Gateway', { status: 502 })
    const path = new URL(url).pathname
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    if (path.startsWith('/api/activate/')) {
      if (path !== `/api/activate/${ACTIVATION}`)
        return json(404, { error: 'Lien d’activation invalide ou expiré.' })
      if (init.method === 'GET') return json(200, { email: user.email, name: user.name })
      const body = JSON.parse(String(init.body))
      return body.password === 'choisi-par-moi'
        ? json(200, { token: 'tok-new', user })
        : json(400, { error: 'Mot de passe trop court.' })
    }
    if (path === '/api/login') {
      const body = JSON.parse(String(init.body))
      return body.password === 'secret'
        ? json(200, { token: 'tok-123', user })
        : json(401, { error: 'E-mail ou mot de passe incorrect.' })
    }
    if (state.expired) return json(401, { error: 'Connexion requise.' })
    if (path === '/api/rpc') {
      const call = JSON.parse(String(init.body))
      if (call.method === 'pages.list')
        return json(200, { result: [{ id: 'p1', title: state.title }] })
      return json(200, { result: null })
    }
    if (path === '/api/logout') return json(200, { ok: true })
    if (path === '/api/health') return json(200, { ok: true })
    if (path === '/api/me') return json(200, { user })
    return json(404, { error: 'Introuvable.' })
  }
  return { fetch, requests, state }
}

/** Short delays, so that the tests do not wait for the real ones. */
const TIMING = { answer: 60, call: 60, probe: 40, retry: 150 }

function setup(): {
  dir: string
  file: string
  cache: ServerCache
  server: FakeServer
  link: ServerLink
} {
  const dir = mkdtempSync(join(tmpdir(), 'notionix-link-'))
  const server = fakeServer()
  const cache = new ServerCache(join(dir, 'cache.db'))
  const file = join(dir, 'server.json')
  const link = new ServerLink(file, cache, secrets, server.fetch, TIMING)
  return { dir, file, cache, server, link }
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const rpc = (
  method: string,
  ...args: unknown[]
): { method: 'POST'; headers: Record<string, string>; body: string } => ({
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json', 'X-Notionix-Workspace': 'main' },
  body: JSON.stringify({ method, args })
})
const decode = (body: Uint8Array | null): unknown => JSON.parse(new TextDecoder().decode(body!))

describe('server cache', () => {
  it('keeps operations that only read', () => {
    const read = cacheKeyOf(
      'https://s',
      'main',
      'POST',
      '/api/rpc',
      '{"method":"pages.get","args":["p1"]}'
    )
    expect(read).toContain('pages.get')
    expect(
      cacheKeyOf(
        'https://s',
        'main',
        'POST',
        '/api/rpc',
        '{"method":"pages.update","args":["p1",{}]}'
      )
    ).toBeNull()
    expect(cacheKeyOf('https://s', 'main', 'GET', '/api/me', null)).not.toBeNull()
    expect(cacheKeyOf('https://s', 'main', 'POST', '/api/assets', null)).toBeNull()
    // Another workspace is another answer.
    expect(
      cacheKeyOf('https://s', 'w2', 'POST', '/api/rpc', '{"method":"pages.get","args":["p1"]}')
    ).not.toBe(read)
    // The account is the same in every workspace: kept in one, read from another.
    expect(cacheKeyOf('https://s', 'w2', 'GET', '/api/me', null)).toBe(
      cacheKeyOf('https://s', 'main', 'GET', '/api/me', null)
    )
    expect(cacheKeyOf('https://s', 'w2', 'GET', '/api/workspaces', null)).toBe(
      cacheKeyOf('https://s', 'main', 'GET', '/api/workspaces', null)
    )
  })
})

describe('desktop link to a server', () => {
  it('signs in, keeps the token sealed, and sends requests with it', async () => {
    const { file, server, link } = setup()
    const refused = await link.login('https://notionix.local:8443/', 'moi@example.com', 'faux')
    expect(refused).toEqual({
      ok: false,
      error: { kind: 'refused', message: 'E-mail ou mot de passe incorrect.' }
    })
    const result = await link.login('notionix.local:8443', 'moi@example.com', 'secret')
    expect(result).toMatchObject({
      ok: true,
      status: { url: 'https://notionix.local:8443', signedIn: true }
    })
    expect(readFileSync(file, 'utf8')).not.toContain('tok-123')
    expect(link.token()).toBe('tok-123')

    const res = await link.request('/api/rpc', {
      ...rpc('pages.list'),
      headers: { ...rpc('pages.list').headers, Cookie: 'volé=1', Authorization: 'Bearer autre' }
    })
    expect(decode(res.body)).toEqual({ result: [{ id: 'p1', title: 'Accueil' }] })
    const sent = server.requests[server.requests.length - 1].init.headers as Record<string, string>
    expect(sent.Authorization).toBe('Bearer tok-123')
    expect(sent.Cookie).toBeUndefined()
    expect(sent['X-Notionix-Workspace']).toBe('main')
  })

  it('answers from what it kept when the server is out of reach', async () => {
    const { server, link } = setup()
    await link.login('https://s.local', 'moi@example.com', 'secret')
    await link.request('/api/rpc', rpc('pages.list'))
    server.state.title = 'Changé'
    server.state.down = true
    const kept = await link.request('/api/rpc', rpc('pages.list'))
    expect(kept.status).toBe(200)
    expect(kept.headers['x-notionix-offline']).toBeDefined()
    expect(decode(kept.body)).toEqual({ result: [{ id: 'p1', title: 'Accueil' }] })
    // A change cannot wait: refused while offline.
    const change = await link.request('/api/rpc', rpc('pages.update', 'p1', { title: 'x' }))
    expect(change.status).toBe(503)
  })

  it('gives up on a server that never answers, then answers at once until it is back', async () => {
    const { server, link } = setup()
    await link.login('https://s.local', 'moi@example.com', 'secret')
    await link.request('/api/rpc', rpc('pages.list'))
    // No VPN: the request gives up after a moment and what was kept answers.
    server.state.hang = true
    let start = Date.now()
    const kept = await link.request('/api/rpc', rpc('pages.list'))
    expect(Date.now() - start).toBeLessThan(1000)
    expect(kept.status).toBe(200)
    expect(kept.headers['x-notionix-offline']).toBeDefined()
    // Known out of reach: the next ones do not wait, the server is not even tried.
    const tried = server.requests.length
    start = Date.now()
    expect((await link.request('/api/rpc', rpc('pages.list'))).status).toBe(200)
    expect((await link.request('/api/rpc', rpc('pages.get', 'p9'))).status).toBe(503)
    expect((await link.request('/api/rpc', rpc('pages.update', 'p1', {}))).status).toBe(503)
    expect(await link.asset('a'.repeat(64) + '.png')).toBeNull()
    expect(Date.now() - start).toBeLessThan(TIMING.probe)
    expect(server.requests.length).toBe(tried)
    // A moment later the server is tried again (a quick check first).
    server.state.hang = false
    await wait(TIMING.retry + 20)
    const back = await link.request('/api/rpc', rpc('pages.list'))
    expect(back.headers['x-notionix-offline']).toBeUndefined()
    expect(server.requests.slice(tried).map((r) => new URL(r.url).pathname)).toEqual([
      '/api/health',
      '/api/rpc'
    ])
  })

  it('tries the server again at once when asked (the real-time connection is back)', async () => {
    const { server, link } = setup()
    await link.login('https://s.local', 'moi@example.com', 'secret')
    server.state.down = true
    expect((await link.request('/api/rpc', rpc('pages.update', 'p1', {}))).status).toBe(503)
    server.state.down = false
    expect(await link.probe()).toBe(true)
    expect((await link.request('/api/rpc', rpc('pages.update', 'p1', {}))).status).toBe(200)
  })

  it('takes a proxy without its server (Caddy while it restarts) for a server out of reach', async () => {
    const { server, link } = setup()
    await link.login('https://s.local', 'moi@example.com', 'secret')
    await link.request('/api/rpc', rpc('pages.list'))
    server.state.gateway = true
    const kept = await link.request('/api/rpc', rpc('pages.list'))
    expect(kept.status).toBe(200)
    expect(decode(kept.body)).toEqual({ result: [{ id: 'p1', title: 'Accueil' }] })
    expect(await link.probe()).toBe(false)
  })

  it('opens without network at once: the server is checked as the app starts', async () => {
    const { file, cache, server, link } = setup()
    await link.login('https://s.local', 'moi@example.com', 'secret')
    await link.request('/api/me', { method: 'GET', headers: { 'X-Notionix-Workspace': 'main' } })
    server.state.hang = true
    const start = Date.now()
    const restarted = new ServerLink(file, cache, secrets, server.fetch, {
      ...TIMING,
      answer: 5_000
    })
    // Read from another workspace: the account is the same.
    const me = await restarted.request('/api/me', {
      method: 'GET',
      headers: { 'X-Notionix-Workspace': 'w2' }
    })
    expect(Date.now() - start).toBeLessThan(1000)
    expect(me.status).toBe(200)
    expect(me.headers['x-notionix-offline']).toBeDefined()
  })

  it('refuses requests outside the API', async () => {
    const { link } = setup()
    await link.login('https://s.local', 'moi@example.com', 'secret')
    expect((await link.request('/../etc', { method: 'GET', headers: {} })).status).toBe(400)
    expect((await link.request('/index.html', { method: 'GET', headers: {} })).status).toBe(400)
    expect((await link.request('/api/../x', { method: 'GET', headers: {} })).status).toBe(400)
  })

  it('asks for the password again once the session has ended, and forgets all on sign-out', async () => {
    const { file, cache, server, link } = setup()
    await link.login('https://s.local', 'moi@example.com', 'secret')
    await link.request('/api/rpc', rpc('pages.list'))
    server.state.expired = true
    expect((await link.request('/api/rpc', rpc('pages.list'))).status).toBe(401)
    expect(link.status()).toMatchObject({ url: 'https://s.local', signedIn: false })
    // The link survives a restart, signed out.
    expect(new ServerLink(file, cache, secrets, server.fetch).status()?.signedIn).toBe(false)

    await link.logout()
    expect(link.status()).toBeNull()
    server.state.down = true
    await link.login('https://s.local', 'moi@example.com', 'secret').catch(() => undefined)
    expect(
      cache.get(cacheKeyOf('https://s.local', 'main', 'POST', '/api/rpc', rpc('pages.list').body)!)
    ).toBeNull()
  })

  it('activates an account with the link shared through Keeper, and links the app', async () => {
    const { file, link } = setup()
    const address = `https://s.local:8443/activate/${ACTIVATION}`
    expect(await link.activation(address)).toEqual({
      ok: true,
      info: { url: 'https://s.local:8443', email: 'moi@example.com', name: 'Moi' }
    })
    expect(await link.activation('https://s.local:8443/activate/inconnue-0123456789')).toEqual({
      ok: false,
      error: { kind: 'refused', message: 'Lien d’activation invalide ou expiré.' }
    })
    expect(await link.activate(address, 'court')).toMatchObject({ ok: false })
    expect(link.status()).toBeNull()
    expect(await link.activate(address, 'choisi-par-moi')).toMatchObject({
      ok: true,
      status: { url: 'https://s.local:8443', email: 'moi@example.com', signedIn: true }
    })
    expect(link.token()).toBe('tok-new')
    expect(readFileSync(file, 'utf8')).not.toContain('tok-new')
  })

  it('tells a certificate problem from an unreachable server', async () => {
    const { cache, dir } = setup()
    const certificate = new ServerLink(join(dir, 'a.json'), cache, secrets, async () => {
      throw new Error('net::ERR_CERT_AUTHORITY_INVALID')
    })
    expect(await certificate.login('https://s.local', 'a@b.c', 'x')).toEqual({
      ok: false,
      error: { kind: 'certificate' }
    })
    const down = new ServerLink(join(dir, 'b.json'), cache, secrets, async () => {
      throw new TypeError('fetch failed')
    })
    expect(await down.login('https://s.local', 'a@b.c', 'x')).toEqual({
      ok: false,
      error: { kind: 'unreachable' }
    })
  })
})
