import { zipSync, strToU8 } from 'fflate'
import type { DatabaseData, Page, PageId, PageSummary } from '../../shared/types'
import { assetNameFromSrc } from '../../shared/assets'
import { docToMarkdown } from './docToMarkdown'
import { stringifyCsv } from './csv'
import {
  displayValue,
  rowValue,
  type DatabaseRow,
  type PropertyDef,
  type PropertyValue
} from '../../shared/database'
import type { JsonNode } from './markdownToDoc'

export interface ExportedFile {
  path: string
  markdown: string
}

export interface ExportedAttachment {
  path: string
  bytes: Uint8Array
}

export interface MarkdownExport {
  files: ExportedFile[]
  /** Images used by the pages, stored next to them like Notion does */
  attachments: ExportedAttachment[]
}

// Control characters are exactly what must not appear in a file name.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g

/** File-system safe, human-readable name for a page title. */
export function safeName(title: string): string {
  const cleaned = title
    .replace(FORBIDDEN, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim()
  return cleaned || 'Sans titre'
}

/**
 * Lays pages out like Notion does: `Title.md` plus a `Title/` folder holding
 * its sub-pages and images. `rootId` limits the export to one page and its
 * descendants. Images whose file is missing are left out of the Markdown.
 */
export async function exportPagesAsMarkdown(
  summaries: PageSummary[],
  load: (id: PageId) => Page | null,
  readAsset: (src: string) => Promise<Uint8Array | null>,
  rootId: PageId | null,
  loadDatabase: (id: PageId) => DatabaseData | null = () => null
): Promise<MarkdownExport> {
  const live = summaries.filter((p) => !p.trashedAt)
  const byParent = new Map<PageId | null, PageSummary[]>()
  for (const page of live) {
    const list = byParent.get(page.parentId) ?? []
    list.push(page)
    byParent.set(page.parentId, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position)

  const roots = rootId ? live.filter((p) => p.id === rootId) : (byParent.get(null) ?? [])
  const paths = new Map<PageId, string>()
  const order: PageSummary[] = []
  const namesByDir = new Map<string, Set<string>>()
  const place = (page: PageSummary, dir: string): void => {
    const taken = namesByDir.get(dir) ?? new Set<string>()
    namesByDir.set(dir, taken)
    const base = safeName(page.title)
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} (${n})`
    taken.add(name.toLowerCase())
    // Like Notion: a database is a CSV next to a folder holding its row pages.
    const isDatabase = page.kind === 'database'
    paths.set(page.id, `${dir}${name}.${isDatabase ? 'csv' : 'md'}`)
    order.push(page)
    for (const child of byParent.get(page.id) ?? []) {
      if (isDatabase && child.isTemplate) continue // templates are not data
      place(child, `${dir}${name}/`)
    }
  }
  for (const page of roots) place(page, '')

  const titles = new Map(summaries.map((p) => [p.id, p.title]))
  const databases = new Map<PageId, DatabaseData | null>()
  const databaseOf = (id: PageId | null): DatabaseData | null => {
    if (id === null) return null
    if (!databases.has(id)) databases.set(id, loadDatabase(id))
    return databases.get(id) ?? null
  }

  const attachments = new Map<string, Uint8Array>()
  const files: ExportedFile[] = []
  for (const summary of order) {
    const path = paths.get(summary.id)!
    if (summary.kind === 'database') {
      const data = databaseOf(summary.id)
      if (data) files.push({ path, markdown: databaseCsv(data, (id) => titles.get(id)) })
      continue
    }
    const page = load(summary.id)
    const doc = page ? (JSON.parse(page.content) as JsonNode) : { type: 'doc' }
    const fromDir = path.slice(0, path.lastIndexOf('/') + 1)
    const pageFolder = path.replace(/\.(md|csv)$/, '') + '/'

    const imagePaths = new Map<string, string>()
    for (const src of imageSources(doc)) {
      const name = assetNameFromSrc(src)
      const bytes = name ? await readAsset(src) : null
      if (!name || !bytes) continue
      attachments.set(pageFolder + name, bytes)
      imagePaths.set(src, relativeLink(fromDir, pageFolder + name))
    }

    const body = docToMarkdown(
      doc,
      (id) => {
        const target = paths.get(id)
        return target ? relativeLink(fromDir, target) : null
      },
      (src) => imagePaths.get(src) ?? null
    )
    const heading = `# ${summary.title || 'Sans titre'}`
    const parentDb = databaseOf(summary.parentId)
    const row = parentDb?.rows.find((r) => r.id === summary.id)
    const props = parentDb && row ? propertyLines(parentDb, row, (id) => titles.get(id)) : ''
    const head = props ? `${heading}\n\n${props}` : heading
    files.push({ path, markdown: body ? `${head}\n\n${body}\n` : `${head}\n` })
  }
  return {
    files,
    attachments: [...attachments].map(([path, bytes]) => ({ path, bytes }))
  }
}

const cellText = (
  prop: PropertyDef,
  value: PropertyValue,
  titleOf: (id: string) => string | undefined
): string =>
  prop.type === 'checkbox' ? (value === true ? 'Yes' : 'No') : displayValue(prop, value, titleOf)

/** Notion's CSV layout: the title column first, then one column per property. */
function databaseCsv(data: DatabaseData, titleOf: (id: string) => string | undefined): string {
  const props = data.schema.properties
  const rows = data.rows
    .filter((r) => !r.isTemplate)
    .sort((a, b) => a.position - b.position)
    .map((r) => props.map((p) => cellText(p, rowValue(r, p), titleOf)))
  return stringifyCsv([props.map((p) => p.name), ...rows])
}

/** "Name: value" lines under a row's title, as in Notion's Markdown export. */
function propertyLines(
  data: DatabaseData,
  row: DatabaseRow,
  titleOf: (id: string) => string | undefined
): string {
  return data.schema.properties
    .filter((p) => p.type !== 'title' && p.type !== 'created_time' && p.type !== 'last_edited_time')
    .map((p) => [p.name, cellText(p, rowValue(row, p), titleOf)] as const)
    .filter(([, text]) => text !== '' && text !== 'No')
    .map(([name, text]) => `${name}: ${text.replace(/\n/g, ' ')}`)
    .join('\n')
}

function imageSources(node: JsonNode, out: Set<string> = new Set()): Set<string> {
  if (node.type === 'image' && typeof node.attrs?.src === 'string') out.add(node.attrs.src)
  for (const child of node.content ?? []) imageSources(child, out)
  return out
}

/** URL-encoded relative path from directory `fromDir` ("a/b/") to file `target`. */
function relativeLink(fromDir: string, target: string): string {
  const from = fromDir.split('/').filter(Boolean)
  const to = target.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1
  const segments = [...from.slice(common).map(() => '..'), ...to.slice(common)]
  return segments.map((s) => (s === '..' ? s : encodeURIComponent(s))).join('/')
}

export function zipMarkdown(
  files: ExportedFile[],
  attachments: ExportedAttachment[] = []
): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
  for (const file of files) entries[file.path] = strToU8(file.markdown)
  // Images are already compressed.
  for (const a of attachments) entries[a.path] = [a.bytes, { level: 0 }]
  return zipSync(entries, { level: 6 })
}
