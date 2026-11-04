import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { NotionApiError, type NotionClient } from './client'
import type {
  NotionBlock,
  NotionBlockData,
  NotionComment,
  NotionCustomEmoji,
  NotionDataSource,
  NotionDatabase,
  NotionFile,
  NotionIcon,
  NotionPage,
  NotionRichText,
  NotionUser,
  NotionView
} from './types'

/**
 * Reads everything the integration can see in Notion into a folder, so the
 * migration itself works offline and can be run again without asking Notion:
 *
 *   users.json, emojis.json, index.json
 *   objects/<id>.json   a page (with its blocks and comments) or a database
 *                       (with its data sources, their rows and views)
 *   files/<sha256>.<ext> and files.json: Notion's files, downloaded at once
 *                       since Notion's links expire after an hour
 *
 * Fetching again skips the pages Notion reports unchanged.
 */

export interface PageSnapshot {
  kind: 'page'
  page: NotionPage
  blocks: NotionBlock[]
  comments: NotionComment[]
}

export interface DataSourceSnapshot {
  source: NotionDataSource
  rows: NotionPage[]
  views: NotionView[]
}

export interface DatabaseSnapshot {
  kind: 'database'
  database: NotionDatabase
  sources: DataSourceSnapshot[]
}

export type ObjectSnapshot = PageSnapshot | DatabaseSnapshot

export interface StoredFile {
  /** File name in files/, or null when it could not be downloaded */
  file: string | null
  /** Name the file had in Notion */
  name: string
  size: number
  contentType: string | null
  error?: string
}

export interface CrawlIndex {
  /** id → last_edited_time, as of the last fetch */
  pages: Record<string, string>
  databases: Record<string, string>
  fetchedAt: string
  errors: { id: string; message: string }[]
}

export interface CrawlOptions {
  /** Comments made on blocks, not only on the page (one request per block) */
  blockComments?: boolean
  log?: (message: string) => void
  fetch?: typeof fetch
}

const MAX_FILE_BYTES = 200 * 1024 * 1024

export async function crawlNotion(
  client: NotionClient,
  dir: string,
  options: CrawlOptions = {}
): Promise<CrawlIndex> {
  const log = options.log ?? (() => undefined)
  const download = options.fetch ?? fetch
  await mkdir(join(dir, 'objects'), { recursive: true })
  await mkdir(join(dir, 'files'), { recursive: true })
  const previous = await readJson<CrawlIndex>(join(dir, 'index.json'))
  const files = new FileStore(dir, download, log)
  await files.load()
  const index: CrawlIndex = {
    pages: {},
    databases: {},
    fetchedAt: new Date().toISOString(),
    errors: []
  }

  // Who the token acts as (a personal token: its creator; an integration: a bot).
  try {
    await writeJson(join(dir, 'me.json'), await client.request('GET', '/users/me'))
  } catch (e) {
    index.errors.push({ id: 'users/me', message: errorText(e) })
  }
  log('Comptes Notion…')
  let users: NotionUser[] = []
  try {
    users = await client.all<NotionUser>('GET', '/users')
  } catch (e) {
    // Personal tokens cannot list people: they come from the Notion app (notion-teamspaces.py).
    index.errors.push({ id: 'users', message: errorText(e) })
  }
  await writeJson(join(dir, 'users.json'), users)
  let emojis: NotionCustomEmoji[] = []
  try {
    emojis = await client.all<NotionCustomEmoji>('GET', '/custom_emojis')
  } catch (e) {
    index.errors.push({ id: 'custom_emojis', message: errorText(e) })
  }
  for (const emoji of emojis) await files.fetch(emoji.url, `${emoji.name}.png`)
  await writeJson(join(dir, 'emojis.json'), emojis)

  log('Liste des pages et bases partagées avec l’intégration…')
  const found = await client.all<{ object: string; id: string; last_edited_time: string }>(
    'POST',
    '/search',
    {}
  )
  const pages = found.filter((o) => o.object === 'page') as unknown as NotionPage[]
  const sources = found.filter((o) => o.object === 'data_source') as unknown as NotionDataSource[]
  const databaseIds = new Set<string>()
  for (const s of sources) {
    const parent = s.parent ?? s.database_parent
    if (parent?.type === 'database_id' && parent.database_id) databaseIds.add(parent.database_id)
  }
  log(`${pages.length} page(s), ${databaseIds.size} base(s)`)

  const fail = (id: string, e: unknown): void => {
    index.errors.push({ id, message: errorText(e) })
    log(`  ${id} : ${errorText(e)}`)
  }

  // Databases first: their rows are pages, fetched below with the others.
  let n = 0
  for (const id of databaseIds) {
    n += 1
    try {
      const snapshot = await fetchDatabase(client, id, files)
      index.databases[id] = snapshot.database.last_edited_time
      await writeJson(objectPath(dir, id), snapshot)
      log(`base ${n}/${databaseIds.size} : ${plain(snapshot.database.title) || id}`)
    } catch (e) {
      fail(id, e)
    }
  }

  const rowPages = new Map<string, NotionPage>()
  for (const id of databaseIds) {
    const snapshot = await readJson<DatabaseSnapshot>(objectPath(dir, id))
    for (const source of snapshot?.sources ?? [])
      for (const row of source.rows) rowPages.set(row.id, row)
  }
  const allPages = new Map<string, NotionPage>()
  for (const p of pages) allPages.set(p.id, p)
  for (const p of rowPages.values()) if (!allPages.has(p.id)) allPages.set(p.id, p)

  n = 0
  for (const page of allPages.values()) {
    n += 1
    if (page.in_trash || page.archived) continue
    index.pages[page.id] = page.last_edited_time
    const path = objectPath(dir, page.id)
    if (previous?.pages[page.id] === page.last_edited_time && existsSync(path)) continue
    try {
      const snapshot = await fetchPage(client, page, files, options.blockComments === true)
      await writeJson(path, snapshot)
      if (n % 25 === 0 || n === allPages.size) {
        log(`page ${n}/${allPages.size}`)
        await files.save()
      }
    } catch (e) {
      delete index.pages[page.id]
      fail(page.id, e)
    }
  }
  await files.save()
  await writeJson(join(dir, 'index.json'), index)
  log(`Terminé : ${client.requests} requête(s) à Notion, ${index.errors.length} erreur(s).`)
  return index
}

async function fetchDatabase(
  client: NotionClient,
  id: string,
  files: FileStore
): Promise<DatabaseSnapshot> {
  const database = await client.request<NotionDatabase>('GET', `/databases/${id}`)
  await files.icon(database.icon)
  await files.file(database.cover)
  // The database's own views (by data source, not its linked views on other pages).
  let views: NotionView[] = []
  try {
    const refs = await client.all<{ id: string }>('GET', `/views?database_id=${id}`)
    for (const v of refs) views.push(await client.request<NotionView>('GET', `/views/${v.id}`))
  } catch (e) {
    // Views are a recent part of the API: without them, the database gets a table view.
    if (!(e instanceof NotionApiError)) throw e
    views = []
  }
  const sources: DataSourceSnapshot[] = []
  for (const [i, ref] of (database.data_sources ?? []).entries()) {
    const source = await client.request<NotionDataSource>('GET', `/data_sources/${ref.id}`)
    const rows = await client.all<NotionPage>('POST', `/data_sources/${ref.id}/query`, {})
    for (const row of rows) await rowFiles(client, row, files)
    const own = views.filter((v) =>
      v.data_source_id ? v.data_source_id === ref.id : i === 0 && v.type !== 'dashboard'
    )
    sources.push({ source, rows, views: own })
  }
  return { kind: 'database', database, sources }
}

/** Downloads the files of a row's properties; long lists Notion cuts short are read in full. */
async function rowFiles(client: NotionClient, row: NotionPage, files: FileStore): Promise<void> {
  await files.icon(row.icon)
  await files.file(row.cover)
  for (const [name, value] of Object.entries(row.properties)) {
    if (value.type === 'files') {
      for (const f of (value.files as NotionFile[] | undefined) ?? []) await files.file(f)
    }
    // Relations and people of more than 25 entries come back cut short.
    if ((value.type === 'relation' || value.type === 'people') && value.has_more === true) {
      const items = await client.all<Record<string, unknown>>(
        'GET',
        `/pages/${row.id}/properties/${encodeURIComponent(value.id)}`
      )
      row.properties[name] = {
        ...value,
        [value.type]: items.map((i) => i[value.type]),
        has_more: false
      }
    }
  }
}

async function fetchPage(
  client: NotionClient,
  listed: NotionPage,
  files: FileStore,
  blockComments: boolean
): Promise<PageSnapshot> {
  // Read again: the links to Notion's files in the listing have expired after an hour.
  const page = await client.request<NotionPage>('GET', `/pages/${listed.id}`)
  await rowFiles(client, page, files)
  const blockIds: string[] = []
  const children = async (id: string, depth: number): Promise<NotionBlock[]> => {
    const blocks = await client.all<NotionBlock>('GET', `/blocks/${id}/children`)
    for (const block of blocks) {
      blockIds.push(block.id)
      await blockFiles(block, files)
      // Sub-pages and databases are fetched on their own.
      if (
        block.has_children &&
        block.type !== 'child_page' &&
        block.type !== 'child_database' &&
        depth < 30
      )
        block.children = await children(block.id, depth + 1)
    }
    return blocks
  }
  const blocks = await children(page.id, 0)
  const comments: NotionComment[] = []
  const commentsOf = async (id: string): Promise<void> => {
    try {
      comments.push(...(await client.all<NotionComment>('GET', `/comments?block_id=${id}`)))
    } catch (e) {
      // Without the "read comments" capability, the page goes without its comments.
      if (!(e instanceof NotionApiError) || e.status !== 403) throw e
    }
  }
  await commentsOf(page.id)
  if (blockComments) for (const id of blockIds) await commentsOf(id)
  const seen = new Set<string>()
  return {
    kind: 'page',
    page,
    blocks,
    comments: comments.filter((c) => !seen.has(c.id) && seen.add(c.id))
  }
}

async function blockFiles(block: NotionBlock, files: FileStore): Promise<void> {
  const data = block[block.type] as NotionBlockData | undefined
  if (!data) return
  if (['image', 'file', 'pdf', 'video', 'audio'].includes(block.type)) {
    // External videos and files are links (YouTube…); external images are kept as images.
    if (data.type === 'file' || (data.type === 'external' && block.type === 'image'))
      await files.file(data as unknown as NotionFile)
  }
  if (block.type === 'callout') await files.icon(data.icon ?? null)
  for (const text of [...(data.rich_text ?? []), ...(data.caption ?? [])])
    await files.richText(text)
  for (const cell of data.cells ?? []) for (const t of cell) await files.richText(t)
}

/** Key of a file: Notion's own files change link at every reading but keep their path. */
export function fileKey(url: string): string {
  try {
    const u = new URL(url)
    if (
      /(^|\.)amazonaws\.com$|notion-static\.com$|notion\.so$|notionusercontent\.com$/.test(
        u.hostname
      )
    )
      return `${u.origin}${u.pathname}`
    return url
  } catch {
    return url
  }
}

class FileStore {
  private entries: Record<string, StoredFile> = {}

  constructor(
    private readonly dir: string,
    private readonly download: typeof fetch,
    private readonly log: (m: string) => void
  ) {}

  async load(): Promise<void> {
    this.entries = (await readJson<Record<string, StoredFile>>(join(this.dir, 'files.json'))) ?? {}
  }

  async save(): Promise<void> {
    await writeJson(join(this.dir, 'files.json'), this.entries)
  }

  async icon(icon: NotionIcon | null): Promise<void> {
    if (!icon) return
    if (icon.type === 'file') await this.fetch(icon.file.url)
    else if (icon.type === 'external') await this.fetch(icon.external.url)
    else if (icon.type === 'custom_emoji' && icon.custom_emoji.url)
      await this.fetch(icon.custom_emoji.url, `${icon.custom_emoji.name ?? 'emoji'}.png`)
  }

  async file(file: NotionFile | null | undefined): Promise<void> {
    if (!file) return
    if (file.type === 'file') await this.fetch(file.file.url, file.name)
    else if (file.type === 'external') await this.fetch(file.external.url, file.name)
  }

  async richText(text: NotionRichText): Promise<void> {
    const emoji = text.mention?.type === 'custom_emoji' ? text.mention.custom_emoji : undefined
    if (emoji?.url) await this.fetch(emoji.url, `${emoji.name ?? 'emoji'}.png`)
  }

  async fetch(url: string, name?: string): Promise<void> {
    const key = fileKey(url)
    if (this.entries[key]?.file) return
    const fallbackName = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'fichier')
    const entry: StoredFile = { file: null, name: name || fallbackName, size: 0, contentType: null }
    try {
      const res = await this.download(url, { signal: AbortSignal.timeout(300_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const length = Number(res.headers.get('content-length'))
      if (length > MAX_FILE_BYTES) throw new Error(`trop volumineux (${length} octets)`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength > MAX_FILE_BYTES)
        throw new Error(`trop volumineux (${bytes.byteLength} octets)`)
      const hash = createHash('sha256').update(bytes).digest('hex')
      const ext = (entry.name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase()
      const file = `${hash}.${ext}`
      if (!existsSync(join(this.dir, 'files', file)))
        await writeFile(join(this.dir, 'files', file), bytes)
      entry.file = file
      entry.size = bytes.byteLength
      entry.contentType = res.headers.get('content-type')
    } catch (e) {
      entry.error = errorText(e)
      this.log(`  fichier non téléchargé (${entry.name}) : ${entry.error}`)
    }
    this.entries[key] = entry
  }
}

export const objectPath = (dir: string, id: string): string => join(dir, 'objects', `${id}.json`)

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.part`, JSON.stringify(value))
  await rename(`${path}.part`, path)
}

const plain = (text: NotionRichText[] | undefined): string =>
  (text ?? []).map((t) => t.plain_text).join('')

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
