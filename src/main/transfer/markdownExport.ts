import { zipSync, strToU8 } from 'fflate'
import type { Page, PageId, PageSummary } from '../../shared/types'
import { docToMarkdown } from './docToMarkdown'
import type { JsonNode } from './markdownToDoc'

export interface ExportedFile {
  path: string
  markdown: string
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
 * its sub-pages. `rootId` limits the export to one page and its descendants.
 */
export function exportPagesAsMarkdown(
  summaries: PageSummary[],
  load: (id: PageId) => Page | null,
  rootId: PageId | null
): ExportedFile[] {
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

  return order.map((summary) => {
    const path = paths.get(summary.id)!
    const page = load(summary.id)
    const doc = page ? (JSON.parse(page.content) as JsonNode) : { type: 'doc' }
    const fromDir = path.slice(0, path.lastIndexOf('/') + 1)
    const body = docToMarkdown(doc, (id) => {
      const target = paths.get(id)
      return target ? relativeLink(fromDir, target) : null
    })
    const heading = `# ${summary.title || 'Sans titre'}`
    return { path, markdown: body ? `${heading}\n\n${body}\n` : `${heading}\n` }
  })
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

export function zipMarkdown(files: ExportedFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[file.path] = strToU8(file.markdown)
  return zipSync(entries, { level: 6 })
}
