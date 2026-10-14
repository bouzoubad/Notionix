import { randomUUID } from 'crypto'
import type { ImportSummary, PageId } from '../../shared/types'
import { pageLinkHref } from '../../shared/editorExtensions'
import type { ImportNode, PageRepository } from '../db/pageRepository'
import { canonicalDoc } from './canonicalDoc'
import { markdownToDoc, newStats, type JsonNode } from './markdownToDoc'
import {
  csvStem,
  isCsv,
  isMarkdown,
  markdownStem,
  notionSource,
  parseNotionName,
  resolveRelative,
  splitPath
} from './notionNames'
import { openSource, type SourceFile } from './sources'
import { parseCsv } from './csv'
import { inferDatabase, type RelationTarget } from './notionDatabase'
import type { AssetStore } from '../assets'

const MAX_MARKDOWN_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const NOTION_URL_ID = /^https?:\/\/(?:[\w-]+\.)?notion\.(?:so|site)\/.*?([0-9a-f]{32})(?:[?#].*)?$/i

type NodeKind = 'page' | 'database' | 'container'

interface PlanNode {
  /** Path of the file or folder without extension; children live in the folder of the same name */
  key: string
  kind: NodeKind
  title: string
  source: string | null
  parentKey: string | null
  file: SourceFile | null
  id: PageId
  existing: boolean
  content: string
  /** database: inferred schema (JSON) */
  dbSchema: string | null
  /** database row: typed values (JSON) */
  properties: string | null
  /** database row: position in the CSV, which is the order of the Notion view */
  csvIndex?: number
}

export interface ImportPlan {
  nodes: PlanNode[]
  databases: number
  linksResolved: number
  linksUnresolved: number
  imagesImported: number
  imagesMissing: number
  attachmentsIgnored: number
  warnings: string[]
}

export interface PlanOptions {
  /** Id of the page already imported from this source, if any */
  existingIdForSource(source: string): PageId | undefined
  newId?: () => PageId
  /** Stores image bytes and returns the src to use; without it, images are dropped */
  saveAsset?: (bytes: Uint8Array, name: string) => Promise<string>
}

const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

/**
 * Builds the page tree of a Notion "Markdown & CSV" export. Sub-pages live in a
 * folder named like their parent page; databases are a CSV next to a folder of
 * row pages. Folders without a page of their own become container pages.
 */
export async function planNotionImport(
  files: SourceFile[],
  options: PlanOptions
): Promise<ImportPlan> {
  const newId = options.newId ?? randomUUID
  const warnings: string[] = []
  const nodes = new Map<string, PlanNode>()
  const usedSources = new Set<string>()
  const pathToId = new Map<string, PageId>()
  const sourceToId = new Map<string, PageId>()
  const fileByPath = new Map(files.map((f) => [f.path, f]))
  const usedAttachments = new Set<string>()
  const attachments = new Set<string>()
  let imagesImported = 0
  let imagesMissing = 0

  const make = (
    key: string,
    kind: NodeKind,
    stem: string,
    file: SourceFile | null,
    extraPath?: string[]
  ): PlanNode => {
    const name = parseNotionName(stem)
    // Pages and databases are identified by their Notion id, a container by its folder path,
    // so importing the same export again finds them instead of creating duplicates.
    let source =
      kind === 'container' ? `notion-folder:${key}` : name.id ? notionSource(name.id) : null
    if (source && usedSources.has(source)) source = null
    if (source) usedSources.add(source)
    const existingId = source ? options.existingIdForSource(source) : undefined
    const node: PlanNode = {
      key,
      kind,
      title: name.title || 'Sans titre',
      source,
      parentKey: null,
      file,
      id: existingId ?? newId(),
      existing: existingId !== undefined,
      content: EMPTY_DOC,
      dbSchema: null,
      properties: null
    }
    nodes.set(key, node)
    for (const p of extraPath ?? []) pathToId.set(p, node.id)
    if (name.id && kind !== 'container') sourceToId.set(name.id, node.id)
    return node
  }

  const csvFiles = new Map<string, string[]>()
  for (const file of files) {
    const { dir, base } = splitPath(file.path)
    if (isMarkdown(base)) {
      make(file.path.replace(/\.[^./]+$/, ''), 'page', markdownStem(base), file, [file.path])
    } else if (isCsv(base)) {
      const key = dir ? `${dir}/${csvStem(base)}` : csvStem(base)
      csvFiles.set(key, [...(csvFiles.get(key) ?? []), file.path])
    } else {
      attachments.add(file.path)
    }
  }
  const csvByDatabase = new Map<string, SourceFile>()
  for (const [key, paths] of csvFiles) {
    if (nodes.has(key)) continue // a page of the same name already stands for it
    make(key, 'database', splitPath(key).base, null, paths)
    // "<name>_all.csv" holds every property; "<name>.csv" only the columns of the default view.
    const best = paths.find((p) => /_all\.csv$/i.test(p)) ?? paths[0]
    csvByDatabase.set(key, fileByPath.get(best)!)
  }

  // Parents: the page (or database) owning the folder a file sits in, else a container for that folder.
  const ownerOf = (folder: string): string | null => {
    if (folder === '') return null
    if (!nodes.has(folder)) {
      const container = make(folder, 'container', splitPath(folder).base, null)
      container.parentKey = ownerOf(splitPath(folder).dir)
    }
    return folder
  }
  for (const node of [...nodes.values()]) {
    if (node.kind !== 'container') node.parentKey = ownerOf(splitPath(node.key).dir)
  }

  const resolveHref =
    (fromDir: string) =>
    (href: string): string | undefined => {
      const notion = NOTION_URL_ID.exec(href)
      if (notion) {
        const id = sourceToId.get(notion[1].toLowerCase())
        return id ? pageLinkHref(id) : undefined
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return undefined
      const path = resolveRelative(fromDir, href)
      const id = path ? pathToId.get(path) : undefined
      return id ? pageLinkHref(id) : undefined
    }

  /**
   * Stores the images a page references and points them at the stored copy.
   * Images that cannot be found or read are removed; remote images become a
   * link, since nothing is fetched from the network.
   */
  const resolveImages = async (node: JsonNode, dir: string): Promise<void> => {
    if (!node.content) return
    const kept: JsonNode[] = []
    for (const child of node.content) {
      if (child.type !== 'image') {
        await resolveImages(child, dir)
        kept.push(child)
        continue
      }
      const src = String(child.attrs?.src ?? '')
      if (/^https?:\/\//i.test(src)) {
        imagesMissing += 1
        kept.push({
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Image distante : ' },
            { type: 'text', text: src, marks: [{ type: 'link', attrs: { href: src } }] }
          ]
        })
        continue
      }
      const path = resolveRelative(dir, src)
      const file = path ? fileByPath.get(path) : undefined
      if (!file || !options.saveAsset || file.size > MAX_IMAGE_BYTES) {
        imagesMissing += 1
        continue
      }
      try {
        const stored = await options.saveAsset(
          new Uint8Array(await file.read()),
          splitPath(file.path).base
        )
        child.attrs = { ...child.attrs, src: stored }
        usedAttachments.add(file.path)
        imagesImported += 1
        kept.push(child)
      } catch (e) {
        imagesMissing += 1
        warnings.push(`${file.path} : ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    node.content = kept
  }

  // --- Databases, first pass: read each CSV and the row pages next to it, so rows
  // keep the CSV order and relations can point to rows of any database.
  const rawText = new Map<string, string>()
  const readMarkdown = async (node: PlanNode): Promise<string | null> => {
    if (!node.file) return null
    if (rawText.has(node.key)) return rawText.get(node.key)!
    if (node.file.size > MAX_MARKDOWN_BYTES) return null
    const raw = stripBom((await node.file.read()).toString('utf8')).replace(/\r\n?/g, '\n')
    rawText.set(node.key, raw)
    return raw
  }
  const csvDatabases: { node: PlanNode; table: string[][]; rows: PlanNode[] }[] = []
  for (const db of [...nodes.values()]) {
    if (db.kind !== 'database' || db.existing) continue
    const csv = csvByDatabase.get(db.key)
    const table =
      csv && csv.size <= MAX_MARKDOWN_BYTES
        ? parseCsv(stripBom((await csv.read()).toString('utf8')))
        : []
    if (table.length === 0) {
      warnings.push(`${db.title} : CSV illisible ou vide, base créée sans propriétés.`)
      continue
    }
    const children = [...nodes.values()].filter((n) => n.parentKey === db.key && n.kind === 'page')
    for (const child of children) {
      const raw = await readMarkdown(child)
      const title = raw ? splitFrontMatter(raw, 'drop').title : null
      if (title) child.title = title
    }
    const unused = new Set(children)
    const rows = table.slice(1).map((cells, i) => {
      const title = (cells[0] ?? '').trim()
      const page = [...unused].find((c) => c.title === title)
      if (page) {
        unused.delete(page)
        page.csvIndex = i
        return page
      }
      // A CSV row without a page of its own becomes an empty row page.
      const row: PlanNode = {
        key: `${db.key}/#csv-${i}`,
        kind: 'page',
        title,
        source: null,
        parentKey: db.key,
        file: null,
        id: newId(),
        existing: false,
        content: EMPTY_DOC,
        dbSchema: null,
        properties: null,
        csvIndex: i
      }
      nodes.set(row.key, row)
      return row
    })
    let extra = rows.length
    for (const page of unused) page.csvIndex = extra++
    csvDatabases.push({ node: db, table, rows })
  }

  // Relation targets: Notion writes linked rows as "Title (link)" or as bare titles.
  const nodeById = new Map([...nodes.values()].map((n) => [n.id, n]))
  const databaseOfPage = (pageId: string): PlanNode | undefined => {
    const parent = nodeById.get(pageId)?.parentKey
    const db = parent ? nodes.get(parent) : undefined
    return db?.kind === 'database' ? db : undefined
  }
  const rowsByTitle = new Map<string, { id: string; db: PlanNode }[]>()
  for (const { node: db, rows } of csvDatabases) {
    for (const row of rows) {
      const list = rowsByTitle.get(row.title) ?? []
      list.push({ id: row.id, db })
      rowsByTitle.set(row.title, list)
    }
  }
  const resolveRelation =
    (fromDir: string) =>
    (title: string, link: string | null): RelationTarget | null => {
      if (link) {
        // The row's own id comes last: earlier ids belong to the folders above it.
        const ids = link.match(/[0-9a-f]{32}/gi)
        const byId = ids ? sourceToId.get(ids[ids.length - 1].toLowerCase()) : undefined
        const path = byId ? null : resolveRelative(fromDir, link)
        const id = byId ?? (path ? pathToId.get(path) : undefined)
        const db = id ? databaseOfPage(id) : undefined
        return id && db ? { id, database: db.id } : null
      }
      const matches = rowsByTitle.get(title) ?? []
      return matches.length === 1 ? { id: matches[0].id, database: matches[0].db.id } : null
    }

  let relationsFound = 0
  for (const { node: db, table, rows } of csvDatabases) {
    const inferred = inferDatabase(table, {
      resolveRelation: resolveRelation(splitPath(db.key).dir)
    })!
    db.dbSchema = JSON.stringify(inferred.schema)
    relationsFound += inferred.schema.properties.filter((p) => p.type === 'relation').length
    inferred.rows.forEach((r, i) => {
      if (rows[i]) rows[i].properties = JSON.stringify(r.values)
    })
  }
  if (relationsFound) warnings.push(`${relationsFound} relation(s) entre bases reconstruite(s).`)

  // --- Pages
  const stats = newStats()
  const ordered = [...nodes.values()].sort(
    (a, b) =>
      depth(a.key) - depth(b.key) ||
      (a.parentKey ?? '').localeCompare(b.parentKey ?? '') ||
      (a.csvIndex !== undefined && b.csvIndex !== undefined
        ? a.csvIndex - b.csvIndex
        : a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
  )
  const withCsv = new Set(csvDatabases.map((d) => d.node.key))

  for (const node of ordered) {
    if (node.existing || node.kind !== 'page' || !node.file) continue
    if (node.file.size > MAX_MARKDOWN_BYTES) {
      warnings.push(
        `${node.file.path} : fichier trop volumineux (${node.file.size} octets), importé vide.`
      )
      continue
    }
    const raw = (await readMarkdown(node))!
    const parent = node.parentKey ? nodes.get(node.parentKey) : undefined
    const page = splitFrontMatter(
      raw,
      parent?.kind !== 'database' ? 'none' : withCsv.has(parent.key) ? 'drop' : 'text'
    )
    if (page.title) node.title = page.title
    const dir = splitPath(node.file.path).dir
    const doc = markdownToDoc(page.body, resolveHref(dir), stats)
    await resolveImages(doc, dir)
    const canonical = canonicalDoc(doc)
    if (!canonical) {
      warnings.push(
        `${node.title} : contenu non conforme au schéma de l'éditeur, importé en texte brut.`
      )
    }
    node.content = JSON.stringify(canonical ?? plainTextDoc(page.body))
  }

  return {
    nodes: ordered,
    databases: ordered.filter((n) => n.kind === 'database' && !n.existing).length,
    linksResolved: stats.linksResolved,
    linksUnresolved: stats.linksUnresolved,
    imagesImported,
    imagesMissing,
    attachmentsIgnored: [...attachments].filter((p) => !usedAttachments.has(p)).length,
    warnings
  }
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

const depth = (key: string): number => key.split('/').length

function plainTextDoc(markdown: string): JsonNode {
  const lines = markdown.split('\n').filter((l) => l.trim())
  return {
    type: 'doc',
    content: lines.length
      ? lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))
      : [{ type: 'paragraph' }]
  }
}

const PROPERTY_LINE = /^([^:\n]{1,80}):(?:\s(.*))?$/

/**
 * Notion puts the page title as a "# Title" first line and, for database rows,
 * the properties as "Key: value" lines right after it.
 */
export function splitFrontMatter(
  markdown: string,
  /** 'text': database row without CSV, properties kept as bold lines; 'drop': values come from the CSV */
  rowProperties: 'none' | 'text' | 'drop'
): { title: string | null; body: string } {
  const lines = markdown.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i += 1
  let title: string | null = null
  const heading = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i] ?? '')
  if (heading) {
    title = heading[1].replace(/\*\*|`/g, '').trim() || null
    i += 1
  }
  const rest = lines.slice(i)
  if (rowProperties !== 'none') {
    let j = 0
    while (j < rest.length && !rest[j].trim()) j += 1
    const props: string[] = []
    while (j < rest.length && PROPERTY_LINE.test(rest[j])) {
      const [, key, value] = PROPERTY_LINE.exec(rest[j])!
      props.push(`**${key.trim()} :** ${(value ?? '').trim()}`.trimEnd())
      j += 1
    }
    if (props.length && rowProperties === 'drop') return { title, body: rest.slice(j).join('\n') }
    if (props.length)
      return { title, body: [...props.flatMap((p) => [p, '']), ...rest.slice(j)].join('\n') }
  }
  return { title, body: rest.join('\n') }
}

/** Imports a Notion export (zip or folder) into the database; pages imported earlier are left untouched. */
export async function importNotionExport(
  repo: PageRepository,
  path: string,
  assets: Pick<AssetStore, 'save'> | null,
  today: Date = new Date()
): Promise<ImportSummary> {
  const source = await openSource(path)
  try {
    const plan = await planNotionImport(source.files, {
      existingIdForSource: (s) => repo.findIdBySource(s),
      saveAsset: assets ? (bytes, name) => assets.save(bytes, name) : undefined
    })
    const keyToId = new Map(plan.nodes.map((n) => [n.key, n.id]))
    const inputs: ImportNode[] = plan.nodes.map((n) => ({
      id: n.id,
      parentId: n.parentKey ? (keyToId.get(n.parentKey) ?? null) : null,
      title: n.title,
      content: n.content,
      kind: n.kind === 'database' ? 'database' : 'page',
      dbSchema: n.dbSchema,
      properties: n.properties,
      source: n.source,
      existing: n.existing
    }))
    const day = today.toISOString().slice(0, 10)
    const { created, containerId } = repo.importNodes(inputs, `Importé de Notion (${day})`)
    return {
      created,
      skipped: plan.nodes.filter((n) => n.existing).length,
      containerId,
      databases: plan.databases,
      linksResolved: plan.linksResolved,
      linksUnresolved: plan.linksUnresolved,
      imagesImported: plan.imagesImported,
      imagesMissing: plan.imagesMissing,
      attachmentsIgnored: plan.attachmentsIgnored,
      warnings: plan.warnings
    }
  } finally {
    await source.close()
  }
}
