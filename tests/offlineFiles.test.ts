import { createHash } from 'crypto'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { AssetStore } from '../src/core/assets'
import { openDatabase } from '../src/core/db/database'
import { PageRepository } from '../src/core/db/pageRepository'
import { cacheKeyOf, ServerCache } from '../src/core/serverCache'
import { filesToFree, localAssets, OfflineFiles } from '../src/main/offlineFiles'

const SERVER = 'https://notionix.test'
const PNG = (seed: number): Uint8Array => {
  const head = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  return new Uint8Array(Buffer.concat([head, Buffer.from([seed])]))
}
const nameOf = (bytes: Uint8Array): string =>
  `${createHash('sha256').update(bytes).digest('hex')}.png`
const src = (name: string): string => `notionix-asset://file/${name}`
const encode = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v))
const keyOf = (workspace: string, method: string, ...args: unknown[]): string =>
  cacheKeyOf(SERVER, workspace, 'POST', '/api/rpc', JSON.stringify({ method, args }))!

describe('offline copies: files and answers kept on this computer', () => {
  it('forgets the answers of a page, not the lists nor the other pages', () => {
    const cache = new ServerCache(join(mkdtempSync(join(tmpdir(), 'nx-cache-')), 'cache.db'))
    cache.put(keyOf('main', 'pages.get', 'a'), encode({ id: 'a' }))
    cache.put(keyOf('main', 'comments.list', 'a'), encode([]))
    cache.put(keyOf('ws2', 'databases.getRow', 'a'), encode({}))
    cache.put(keyOf('main', 'pages.get', 'b'), encode({ id: 'b' }))
    cache.put(keyOf('main', 'pages.list'), encode([{ id: 'a' }]))
    cache.put(
      cacheKeyOf(
        'https://other.test',
        'main',
        'POST',
        '/api/rpc',
        '{"method":"pages.get","args":["a"]}'
      )!,
      encode({})
    )
    expect(cache.forgetPages(SERVER, ['a'])).toBe(3)
    expect(cache.get(keyOf('main', 'pages.get', 'a'))).toBeNull()
    expect(cache.get(keyOf('main', 'pages.get', 'b'))).not.toBeNull()
    expect(cache.get(keyOf('main', 'pages.list'))).not.toBeNull()
  })

  it('frees only the downloaded files that nothing kept and no page of this computer uses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nx-offline-'))
    const cache = new ServerCache(join(dir, 'cache.db'))
    const assets = new AssetStore(join(dir, 'assets'))
    const db = openDatabase(join(dir, 'local.db'))
    const repo = new PageRepository(db)
    const [kept, onlyEvicted, local, written] = [1, 2, 3, 4].map(PNG)
    const server = new Map([kept, onlyEvicted, local].map((b) => [nameOf(b), b]))
    const files = new OfflineFiles(
      cache,
      assets,
      async (name) => server.get(name) ?? null,
      () => localAssets(db),
      () => SERVER
    )
    // A page written on this computer, with its own image, and one of the server's.
    await assets.put(nameOf(written), written)
    const page = repo.create(null)
    repo.update(page.id, {
      content: JSON.stringify({ src: [src(nameOf(written)), src(nameOf(local))] })
    })
    // Two pages of the server kept: one stays kept, the other goes online only.
    cache.put(keyOf('main', 'pages.get', 'stays'), encode({ content: src(nameOf(kept)) }))
    cache.put(
      keyOf('main', 'pages.get', 'goes'),
      encode({ content: `${src(nameOf(onlyEvicted))} ${src(nameOf(local))}` })
    )
    const sizes = await files.keep([nameOf(kept), nameOf(onlyEvicted), nameOf(local), 'x.png'])
    expect(Object.keys(sizes).sort()).toEqual(
      [nameOf(kept), nameOf(onlyEvicted), nameOf(local)].sort()
    )
    // Already here (written on this computer): not noted as downloaded.
    await files.keep([nameOf(written)])
    expect(cache.fetchedAssets().sort()).toEqual(
      [nameOf(kept), nameOf(onlyEvicted), nameOf(local)].sort()
    )

    const freed = files.forgetPages(['goes'])
    expect(freed).toBe(onlyEvicted.byteLength)
    expect(existsSync(join(dir, 'assets', nameOf(onlyEvicted)))).toBe(false)
    // Still needed: by the page kept, by the page of this computer, or written here.
    for (const b of [kept, local, written]) expect(assets.pathOf(nameOf(b))).not.toBeNull()

    // Signing out: every downloaded file nothing of this computer uses goes.
    cache.clear()
    files.free()
    expect(assets.pathOf(nameOf(kept))).toBeNull()
    expect(assets.pathOf(nameOf(local))).not.toBeNull()
    expect(assets.pathOf(nameOf(written))).not.toBeNull()
  })

  it('never lists a file that was not downloaded', () => {
    expect(filesToFree(['a.png', 'b.png'], new Set(['b.png']))).toEqual(['a.png'])
  })
})
