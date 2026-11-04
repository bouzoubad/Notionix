import { readFile } from 'fs/promises'
import { join } from 'path'
import { zipSync } from 'fflate'
import { assetExtension } from '../../shared/assets'
import type { DatabaseSchema } from '../../shared/database'
import { canonicalDoc } from '../transfer/canonicalDoc'
import type { JsonNode } from '../transfer/markdownToDoc'
import { convertBlocks, plainText, richText, toUuid, type ConvertContext } from './convert'
import {
  fileKey,
  objectPath,
  readJson,
  type CrawlIndex,
  type DataSourceSnapshot,
  type DatabaseSnapshot,
  type ObjectSnapshot,
  type PageSnapshot,
  type StoredFile
} from './crawl'
import { convertRow, convertSchema, stableUuid, type DatabaseContext } from './databases'
import { gradientFor, isNotionGalleryCover, notionIconUrl, pictogramFor } from './icons'
import type {
  NotionBlock,
  NotionCustomEmoji,
  NotionFile,
  NotionIcon,
  NotionParent,
  NotionUser
} from './types'

/**
 * Turns what the crawler read from Notion into Notionix pages: one Notionix
 * workspace per Notion teamspace, the same page ids as in Notion (so links,
 * mentions and relations need no translation and a second run finds what the
 * first one made), Notion's authors and dates, and its files stored in the
 * workspace that shows them.
 */

export interface TeamspaceInfo {
  /** Notion teamspace id */
  id: string
  name: string
  /** Notion's icon: an emoji, a link to an image, or Notion's /icons/<name>_<colour>.svg */
  icon: string | null
  memberEmails: string[]
  /** Its top-level pages, in the order of Notion's sidebar */
  pages: string[]
}

export interface PlanInput {
  dir: string
  teamspaces: TeamspaceInfo[]
  /** Notion's people, when the token cannot list them (personal token): from the Notion app */
  notionUsers?: { id: string; email: string | null; name: string | null }[]
  accounts: { id: string; email: string }[]
  /**
   * Account whose private pages these are: pages of no teamspace go under one
   * page private to it (a personal token sees its creator's private pages)
   */
  owner?: string | null
  /** Stores a file in a workspace (MAIN for the main one); returns its src */
  saveAsset(workspace: string, bytes: Uint8Array, name: string): Promise<string>
  timeZone?: string
}

export const MAIN = 'main'

export interface MigrationNode {
  id: string
  parentId: string | null
  /** MAIN or a Notion teamspace id */
  workspace: string
  title: string
  icon: string | null
  cover: string | null
  content: string
  kind: 'page' | 'database' | 'synced'
  dbSchema: string | null
  properties: string | null
  options: string | null
  access?: 'restricted'
  source: string
  position: number
  createdAt: number
  updatedAt: number
  createdBy: string | null
  updatedBy: string | null
}

export interface MigrationComment {
  id: string
  pageId: string
  workspace: string
  threadId: string
  authorId: string | null
  body: string
  quote: string | null
  createdAt: number
}

export interface MigrationWorkspace {
  key: string
  name: string
  icon: string | null
  memberIds: string[]
  /** Teamspace members without a Notionix account */
  missingMembers: string[]
}

export interface MigrationPlan {
  workspaces: MigrationWorkspace[]
  nodes: MigrationNode[]
  comments: MigrationComment[]
  emojis: { name: string; src: string }[]
  report: MigrationReport
}

export interface MigrationReport {
  pages: number
  databases: number
  rows: number
  syncedBlocks: number
  files: number
  filesMissing: string[]
  /** Pages whose parent is not shared with the integration: placed at the top */
  orphans: string[]
  /** Top-level pages of no known teamspace */
  unassigned: string[]
  /** People of Notion without a Notionix account (e-mail or name) */
  missingPeople: string[]
  notes: Record<string, number>
  crawlErrors: { id: string; message: string }[]
}

const UNASSIGNED_ID = '6e6f7469-6f6e-4d69-8772-61746564000a'

export async function planMigration(input: PlanInput): Promise<MigrationPlan> {
  const timeZone = input.timeZone ?? 'Europe/Paris'
  const index = await readJson<CrawlIndex>(join(input.dir, 'index.json'))
  if (!index)
    throw new Error(`Lecture de Notion introuvable dans ${input.dir} (lancez d’abord fetch).`)
  const users = (await readJson<NotionUser[]>(join(input.dir, 'users.json'))) ?? []
  const emojis = (await readJson<NotionCustomEmoji[]>(join(input.dir, 'emojis.json'))) ?? []
  const files = (await readJson<Record<string, StoredFile>>(join(input.dir, 'files.json'))) ?? {}

  const report: MigrationReport = {
    pages: 0,
    databases: 0,
    rows: 0,
    syncedBlocks: 0,
    files: 0,
    filesMissing: [],
    orphans: [],
    unassigned: [],
    missingPeople: [],
    notes: {},
    crawlErrors: index.errors
  }
  const note = (what: string): void => {
    report.notes[what] = (report.notes[what] ?? 0) + 1
  }

  // --- Read every object
  const pages = new Map<string, PageSnapshot>()
  const databases = new Map<string, DatabaseSnapshot>()
  for (const id of [...Object.keys(index.databases), ...Object.keys(index.pages)]) {
    const snapshot = await readJson<ObjectSnapshot>(objectPath(input.dir, id))
    if (snapshot?.kind === 'page') pages.set(id, snapshot)
    else if (snapshot?.kind === 'database' && !snapshot.database.in_trash)
      databases.set(id, snapshot)
  }

  // --- People
  const accountByEmail = new Map(input.accounts.map((a) => [a.email.toLowerCase(), a.id]))
  const notionUsers = new Map(users.map((u) => [u.id, u]))
  for (const u of input.notionUsers ?? [])
    if (!notionUsers.has(u.id))
      notionUsers.set(u.id, {
        object: 'user',
        id: u.id,
        type: 'person',
        name: u.name,
        person: u.email ? { email: u.email } : {}
      })
  const missingPeople = new Set<string>()
  const userId = (notionId: string): string | null => {
    const user = notionUsers.get(notionId)
    const email = user?.person?.email?.toLowerCase()
    const id = email ? accountByEmail.get(email) : undefined
    if (!id && user?.type !== 'bot' && user) missingPeople.add(email ?? user.name ?? notionId)
    return id ?? null
  }
  const userName = (notionId: string): string => notionUsers.get(notionId)?.name ?? 'Quelqu’un'

  // --- Databases and their data sources
  const sourceToPage = new Map<string, string>()
  const sources = new Map<string, { snapshot: DataSourceSnapshot; database: DatabaseSnapshot }>()
  for (const db of databases.values()) {
    db.sources.forEach((s, i) => {
      sourceToPage.set(s.source.id, i === 0 ? db.database.id : s.source.id)
      sources.set(s.source.id, { snapshot: s, database: db })
    })
  }
  const rowSource = new Map<string, string>()
  const rowOrder = new Map<string, number>()
  for (const [sourceId, { snapshot }] of sources)
    snapshot.rows.forEach((row, i) => {
      rowSource.set(row.id, sourceId)
      rowOrder.set(row.id, i)
    })

  // --- Which page holds each block (blocks can be parents), and the order of sub-pages
  const blockOwner = new Map<string, string>()
  const blockById = new Map<string, NotionBlock>()
  const childOrder = new Map<string, number>()
  for (const [pageId, snapshot] of pages) {
    let order = 0
    const walk = (blocks: NotionBlock[]): void => {
      for (const b of blocks) {
        blockOwner.set(b.id, pageId)
        blockById.set(b.id, b)
        if (b.type === 'child_page' || b.type === 'child_database') childOrder.set(b.id, order++)
        if (b.children) walk(b.children)
      }
    }
    walk(snapshot.blocks)
  }

  // --- Tree
  const sourcePages = new Set(sourceToPage.values())
  const exists = (id: string): boolean => pages.has(id) || databases.has(id) || sourcePages.has(id)
  /** A block as parent (a page inside a toggle or a column) stands for the page holding it. */
  const resolveParent = (p: NotionParent | undefined, self: string): string | null => {
    switch (p?.type) {
      case 'page_id':
        return p.page_id ?? null
      case 'database_id':
        return p.database_id ?? null
      case 'data_source_id':
        return sourceToPage.get(p.data_source_id ?? '') ?? p.database_id ?? null
      case 'block_id': {
        const owner = blockOwner.get(p.block_id ?? '')
        return owner && owner !== self ? owner : null
      }
      default:
        return null
    }
  }
  const parentOf = new Map<string, string | null>()
  for (const [id, s] of pages) parentOf.set(id, resolveParent(s.page.parent, id))
  for (const [id, db] of databases) {
    parentOf.set(id, resolveParent(db.database.parent, id))
    db.sources.slice(1).forEach((s) => parentOf.set(s.source.id, id))
  }
  for (const [id, parent] of parentOf) {
    if (parent && !exists(parent)) {
      report.orphans.push(titleOf(id))
      parentOf.set(id, null)
    }
  }

  // --- Workspaces: a teamspace's top-level pages and everything under them
  const teamOfRoot = new Map<string, string>()
  const topOrder = new Map<string, number>()
  for (const team of input.teamspaces)
    team.pages.forEach((p, i) => {
      teamOfRoot.set(toUuid(p), team.id)
      topOrder.set(toUuid(p), i)
    })
  const rootOf = (id: string): string => {
    let current = id
    for (let guard = 0; guard < 200; guard += 1) {
      const parent = parentOf.get(current)
      if (!parent) return current
      current = parent
    }
    return current
  }
  const workspaceOf = new Map<string, string>()
  let unassigned = false
  for (const id of parentOf.keys()) {
    const root = rootOf(id)
    const team = teamOfRoot.get(root)
    workspaceOf.set(id, team ?? MAIN)
    if (!team && root === id) {
      unassigned = true
      report.unassigned.push(titleOf(id))
    }
  }

  function titleOf(id: string): string {
    const page = pages.get(id)?.page
    if (page) {
      const title = Object.values(page.properties).find((p) => p.type === 'title')
      return plainText(title?.title as never) || 'Sans titre'
    }
    const db = databases.get(id)?.database
    if (db) return plainText(db.title) || 'Base sans titre'
    const source = sources.get(id)?.snapshot.source
    return plainText(source?.title) || 'Source sans titre'
  }

  // --- Files
  const stored = new Map<string, Promise<{ src: string; name: string; size: number } | null>>()
  const asset = (workspace: string) => (url: string, name?: string) => {
    const key = fileKey(url)
    const cacheKey = `${workspace}\u0000${key}`
    if (!stored.has(cacheKey)) stored.set(cacheKey, storeFile(workspace, key, name))
    return stored.get(cacheKey)!
  }
  const storeFile = async (
    workspace: string,
    key: string,
    name?: string
  ): Promise<{ src: string; name: string; size: number } | null> => {
    const entry = files[key]
    if (!entry?.file) {
      report.filesMissing.push(entry?.name ?? name ?? key)
      return null
    }
    try {
      let bytes: Uint8Array = new Uint8Array(await readFile(join(input.dir, 'files', entry.file)))
      let fileName = name || entry.name
      if (!/\.[A-Za-z0-9]{1,8}$/.test(fileName)) {
        // A name without extension (external image links): its type says it.
        const ext = extensionOf(entry.contentType)
        if (ext) fileName = `${fileName}.${ext}`
      }
      if (!assetExtension(fileName)) {
        // A type Notionix does not keep as is (CAD, DICOM…): kept inside a zip.
        bytes = zipSync({ [fileName]: bytes })
        fileName = `${fileName}.zip`
      }
      const src = await input.saveAsset(workspace, bytes, fileName)
      report.files += 1
      return { src, name: name || entry.name, size: bytes.byteLength }
    } catch (e) {
      report.filesMissing.push(`${entry.name} (${e instanceof Error ? e.message : String(e)})`)
      return null
    }
  }

  // --- Team emojis: Notion's custom emojis, under a name the team emojis accept
  const teamEmojis = new Map<string, { name: string; src: string }>()
  const emojiName = (raw: string): string => {
    let name = raw
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32)
    if (name.length < 2) name = `emoji_${name}`.slice(0, 32)
    return name
  }
  const emoji =
    (workspace: string) => async (ref: { id?: string; name?: string; url?: string }) => {
      const known = emojis.find((e) => e.id === ref.id) ?? emojis.find((e) => e.name === ref.name)
      const url = known?.url ?? ref.url
      const rawName = known?.name ?? ref.name
      if (!url || !rawName) return null
      const name = emojiName(rawName)
      const main = await asset(MAIN)(url, `${name}.png`)
      if (!main) return null
      if (!teamEmojis.has(name)) teamEmojis.set(name, { name, src: main.src })
      const here = workspace === MAIN ? main : await asset(workspace)(url, `${name}.png`)
      return here ? { name, src: here.src } : null
    }
  for (const e of emojis) await emoji(MAIN)({ id: e.id })

  const iconOf = async (icon: NotionIcon | null, workspace: string): Promise<string | null> => {
    if (!icon) return null
    switch (icon.type) {
      case 'emoji':
        return icon.emoji
      case 'custom_emoji': {
        const e = await emoji(workspace)(icon.custom_emoji)
        return e?.src ?? null
      }
      case 'icon': {
        const p = pictogramFor(icon.icon.name, icon.icon.color)
        if (!p.matched) note('Pictogramme Notion sans équivalent (pictogramme générique)')
        return p.icon
      }
      case 'external': {
        const named = notionIconUrl(icon.external.url)
        if (named) {
          const p = pictogramFor(named.name, named.color)
          if (!p.matched) note('Pictogramme Notion sans équivalent (pictogramme générique)')
          return p.icon
        }
        return (await asset(workspace)(icon.external.url))?.src ?? null
      }
      case 'file':
        return (await asset(workspace)(icon.file.url))?.src ?? null
      default:
        return null
    }
  }
  const coverOf = async (cover: NotionFile | null, workspace: string): Promise<string | null> => {
    if (!cover) return null
    const url =
      cover.type === 'file' ? cover.file.url : cover.type === 'external' ? cover.external.url : null
    if (!url) return null
    if (isNotionGalleryCover(url)) return gradientFor(url)
    return (await asset(workspace)(url))?.src ?? null
  }

  // --- Contents
  const nodes = new Map<string, MigrationNode>()
  const synced = new Map<string, string>()
  const pageIdOf = (notionId: string): string | null => {
    const id = toUuid(notionId)
    if (sourceToPage.has(id)) return sourceToPage.get(id)!
    return parentOf.has(id) ? id : null
  }
  const contextFor = (pageId: string, workspace: string): ConvertContext & DatabaseContext => ({
    pageId: pageIdOf,
    userId: (id) => userId(id),
    userName,
    asset: asset(workspace),
    emoji: emoji(workspace),
    isInlineDatabase: (id) => databases.get(toUuid(id))?.database.is_inline === true,
    databaseOfSource: (id) => sourceToPage.get(id) ?? null,
    sourceSchema: (id) => sources.get(id)?.snapshot.source.properties ?? null,
    synced: async (originalId, children) => {
      const known = synced.get(originalId)
      if (known) return known
      const id = stableUuid(`notion-synced:${originalId}`)
      synced.set(originalId, id)
      const owner = blockOwner.get(originalId)
      const parent = owner && parentOf.has(owner) ? owner : pageId
      const where = workspaceOf.get(parent) ?? workspace
      const original = blockById.get(originalId)
      const content = await documentOf(
        original?.children ?? children,
        contextFor(parent, where),
        id
      )
      nodes.set(id, {
        ...base(id, parent, where),
        kind: 'synced',
        content,
        source: `notion-synced:${originalId}`
      })
      report.syncedBlocks += 1
      return id
    },
    timeZone,
    note
  })
  const base = (id: string, parentId: string | null, workspace: string): MigrationNode => ({
    id,
    parentId,
    workspace,
    title: '',
    icon: null,
    cover: null,
    content: EMPTY_DOC,
    kind: 'page',
    dbSchema: null,
    properties: null,
    options: null,
    source: `notion:${id.replace(/-/g, '')}`,
    position: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: null,
    updatedBy: null
  })
  const documentOf = async (
    blocks: NotionBlock[],
    ctx: ConvertContext,
    label: string
  ): Promise<string> => {
    const content = await convertBlocks(blocks, ctx)
    const doc: JsonNode = {
      type: 'doc',
      content: content.length ? content : [{ type: 'paragraph' }]
    }
    const valid = canonicalDoc(doc)
    if (valid) return JSON.stringify(valid)
    // Keeps every block the editor accepts; the others become their text.
    const kept: JsonNode[] = []
    for (const block of doc.content!) {
      const one = canonicalDoc({ type: 'doc', content: [block] })
      if (one) kept.push(...one.content!)
      else {
        note('Bloc converti en texte simple (non conforme)')
        const text = textOf(block)
        if (text) kept.push({ type: 'paragraph', content: [{ type: 'text', text }] })
      }
    }
    void label
    return JSON.stringify(
      canonicalDoc({ type: 'doc', content: kept.length ? kept : [{ type: 'paragraph' }] })
    )
  }

  const time = (iso: string | undefined): number => {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) ? t : Date.now()
  }
  const comments: MigrationComment[] = []

  for (const [id, db] of databases) {
    const workspace = workspaceOf.get(id) ?? MAIN
    const d = db.database
    const ctx = contextFor(id, workspace)
    for (const [i, s] of db.sources.entries()) {
      const nodeId = i === 0 ? id : s.source.id
      const schema: DatabaseSchema = convertSchema(s, ctx, d.is_locked === true)
      const description = i === 0 ? await richText(d.description, ctx) : []
      nodes.set(nodeId, {
        ...base(nodeId, i === 0 ? (parentOf.get(id) ?? null) : id, workspace),
        title:
          i === 0 ? plainText(d.title) || 'Base sans titre' : plainText(s.source.title) || 'Source',
        icon: i === 0 ? await iconOf(d.icon, workspace) : null,
        cover: i === 0 ? await coverOf(d.cover, workspace) : null,
        content: description.length
          ? JSON.stringify(
              canonicalDoc({
                type: 'doc',
                content: [{ type: 'paragraph', content: description }]
              }) ?? JSON.parse(EMPTY_DOC)
            )
          : EMPTY_DOC,
        kind: 'database',
        dbSchema: JSON.stringify(schema),
        source: i === 0 ? `notion:${id.replace(/-/g, '')}` : `notion-source:${s.source.id}`,
        createdAt: time(d.created_time),
        updatedAt: time(d.last_edited_time),
        createdBy: d.created_by ? userId(d.created_by.id) : null,
        updatedBy: d.last_edited_by ? userId(d.last_edited_by.id) : null
      })
      report.databases += 1
    }
  }

  for (const [id, snapshot] of pages) {
    const workspace = workspaceOf.get(id) ?? MAIN
    const page = snapshot.page
    const ctx = contextFor(id, workspace)
    const node: MigrationNode = {
      ...base(id, parentOf.get(id) ?? null, workspace),
      title: titleOf(id),
      icon: await iconOf(page.icon, workspace),
      cover: await coverOf(page.cover, workspace),
      createdAt: time(page.created_time),
      updatedAt: time(page.last_edited_time),
      createdBy: page.created_by ? userId(page.created_by.id) : null,
      updatedBy: page.last_edited_by ? userId(page.last_edited_by.id) : null,
      options: page.is_locked ? JSON.stringify({ locked: true }) : null
    }
    nodes.set(id, node)
    const sourceId = rowSource.get(id)
    if (sourceId) {
      const { snapshot: source } = sources.get(sourceId)!
      const dbNode = nodes.get(sourceToPage.get(sourceId)!)
      const schema = dbNode?.dbSchema ? (JSON.parse(dbNode.dbSchema) as DatabaseSchema) : null
      if (schema) {
        const row = await convertRow(page, source, schema, ctx)
        node.title = row.title || node.title
        node.properties = JSON.stringify(row.values)
      }
      report.rows += 1
    } else report.pages += 1
    node.content = await documentOf(snapshot.blocks, ctx, id)
    for (const c of snapshot.comments) {
      const author = c.created_by ? userId(c.created_by.id) : null
      const text = plainText(c.rich_text)
      const quoted =
        c.parent.type === 'block_id' ? blockById.get(c.parent.block_id ?? '') : undefined
      const quote = quoted ? textOfBlock(quoted).slice(0, 300) : null
      comments.push({
        id: c.id,
        pageId: id,
        workspace,
        threadId: c.discussion_id,
        authorId: author,
        body: author
          ? text
          : `${c.display_name?.resolved_name ?? userName(c.created_by.id)} : ${text}`,
        quote: quote || null,
        createdAt: time(c.created_time)
      })
    }
  }

  // --- Pages of no teamspace (private pages, mostly): under one page of the
  // main workspace private to the owner of the token
  if (unassigned) {
    nodes.set(UNASSIGNED_ID, {
      ...base(UNASSIGNED_ID, null, MAIN),
      title: 'Notion : pages hors espaces d’équipe',
      icon: '📥',
      access: 'restricted',
      createdBy: input.owner ?? null,
      updatedBy: input.owner ?? null,
      source: 'notion-migration:unassigned',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Pages Notion d’aucun espace d’équipe (vos pages privées, ou un espace non retrouvé). Cette page et ce qu’elle contient ne sont visibles que par vous : déplacez ou partagez ce qui doit l’être.'
              }
            ]
          }
        ]
      })
    })
    for (const node of nodes.values())
      if (
        node.parentId === null &&
        node.workspace === MAIN &&
        node.id !== UNASSIGNED_ID &&
        node.kind !== 'synced'
      )
        node.parentId = UNASSIGNED_ID
  }

  // --- Order: as in Notion's sidebar, the parent's content, the database's rows
  for (const node of nodes.values()) {
    node.position =
      node.parentId === null
        ? (topOrder.get(node.id) ?? 1000)
        : (rowOrder.get(node.id) ?? childOrder.get(node.id) ?? 100_000)
  }
  const ordered = [...nodes.values()].sort(
    (a, b) =>
      depthOf(a, nodes) - depthOf(b, nodes) || a.position - b.position || a.createdAt - b.createdAt
  )
  const positions = new Map<string, number>()
  for (const node of ordered) {
    const key = `${node.workspace}\u0000${node.parentId ?? ''}`
    const next = (positions.get(key) ?? 0) + 1
    positions.set(key, next)
    node.position = next
  }

  // --- Workspaces
  const workspaces: MigrationWorkspace[] = []
  for (const team of input.teamspaces) {
    if (![...nodes.values()].some((n) => n.workspace === team.id)) continue
    const memberIds: string[] = []
    const missing: string[] = []
    for (const email of team.memberEmails) {
      const id = accountByEmail.get(email.toLowerCase())
      if (id) memberIds.push(id)
      else missing.push(email)
    }
    workspaces.push({
      key: team.id,
      name: team.name,
      icon: await teamIcon(team.icon, team.id),
      memberIds,
      missingMembers: missing
    })
  }
  async function teamIcon(icon: string | null, workspace: string): Promise<string | null> {
    if (!icon) return null
    const named = notionIconUrl(icon)
    if (named) return pictogramFor(named.name, named.color).icon
    if (/^https?:\/\//.test(icon)) return (await asset(workspace)(icon))?.src ?? null
    return icon
  }

  report.missingPeople = [...missingPeople].sort()
  return { workspaces, nodes: ordered, comments, emojis: [...teamEmojis.values()], report }
}

const EMPTY_DOC = '{"type":"doc","content":[{"type":"paragraph"}]}'

function depthOf(node: MigrationNode, nodes: Map<string, MigrationNode>): number {
  let depth = 0
  let current = node
  while (current.parentId && nodes.has(current.parentId) && depth < 200) {
    current = nodes.get(current.parentId)!
    depth += 1
  }
  return depth
}

function textOf(node: JsonNode): string {
  if (node.text) return node.text
  return (node.content ?? []).map(textOf).filter(Boolean).join(' ')
}

function textOfBlock(block: NotionBlock): string {
  const data = block[block.type] as { rich_text?: { plain_text: string }[] } | undefined
  return (data?.rich_text ?? []).map((t) => t.plain_text).join('')
}

const CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3'
}

const extensionOf = (contentType: string | null): string | null =>
  contentType ? (CONTENT_TYPES[contentType.split(';')[0].trim().toLowerCase()] ?? null) : null
