import { zipSync, strToU8 } from 'fflate'
import type { Page, PageId, PageSummary } from '../../shared/types'
import { assetNameFromSrc } from '../../shared/assets'
import { docToMarkdown } from './docToMarkdown'
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
  rootId: PageId | null
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
    paths.set(page.id, `${dir}${name}.md`)
    order.push(page)
    for (const child of byParent.get(page.id) ?? []) place(child, `${dir}${name}/`)
  }
  for (const page of roots) place(page, '')

  const attachments = new Map<string, Uint8Array>()
  const files: ExportedFile[] = []
  for (const summary of order) {
    const path = paths.get(summary.id)!
    const page = load(summary.id)
    const doc = page ? (JSON.parse(page.content) as JsonNode) : { type: 'doc' }
    const fromDir = path.slice(0, path.lastIndexOf('/') + 1)
    const pageFolder = path.slice(0, -'.md'.length) + '/'

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
    files.push({ path, markdown: body ? `${heading}\n\n${body}\n` : `${heading}\n` })
  }
  return {
    files,
    attachments: [...attachments].map(([path, bytes]) => ({ path, bytes }))
  }
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
