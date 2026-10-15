import { strToU8, zipSync } from 'fflate'
import MarkdownIt from 'markdown-it'
import type { PageId, Person } from '../../shared/types'
import type { PageRepository } from '../db/pageRepository'
import type { DatabaseRepository } from '../db/databaseRepository'
import type { AssetStore } from '../assets'
import { exportPagesAsMarkdown, safeName } from './markdownExport'
import { parseCsv } from './csv'
import type { MarkdownArchive } from './markdownExport'

// Pages may hold Notion's <aside> and <details> blocks: HTML is kept; the
// content is the user's own, exported for them.
const md = new MarkdownIt({ html: true, linkify: true })

const escape = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const STYLE = `body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#37352f;max-width:860px;margin:40px auto;padding:0 24px}
img,video{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #e9e9e7;padding:4px 8px;text-align:left}
aside{background:#f1f1ef;border-radius:4px;padding:12px 16px}blockquote{border-left:3px solid #37352f;margin:0;padding-left:14px}
code{background:rgba(135,131,120,.15);padding:2px 4px;border-radius:3px}pre code{display:block;padding:12px;overflow:auto}
@media print{body{margin:0}}`

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`

/** Links between exported files point to their HTML versions. */
const toHtmlLinks = (html: string): string =>
  html.replace(
    /href="([^"]+?)\.(md|csv)(#[^"]*)?"/g,
    (_m, path, _ext, hash = '') => `href="${path}.html${hash}"`
  )

/** A database's CSV as an HTML table. */
function csvTable(csv: string): string {
  const rows = parseCsv(csv)
  if (rows.length === 0) return ''
  const [head, ...rest] = rows
  return `<table><thead><tr>${head.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${rest
    .map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}

/**
 * The same tree as the Markdown export, as web pages: one .html per page or
 * database, images and files beside them, links between pages kept.
 */
export async function buildHtmlArchive(
  repo: Pick<PageRepository, 'list' | 'get'>,
  dbs: Pick<DatabaseRepository, 'get'>,
  assets: Pick<AssetStore, 'read'>,
  pageId: PageId | null,
  people: Person[] = []
): Promise<MarkdownArchive> {
  const { files, attachments } = await exportPagesAsMarkdown(
    repo.list(),
    (id) => repo.get(id),
    (src) => assets.read(src),
    pageId,
    (id) => dbs.get(id),
    people
  )
  if (files.length === 0) throw new Error('Aucune page à exporter.')
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
  for (const file of files) {
    const isCsv = file.path.endsWith('.csv')
    const title = file.path
      .split('/')
      .pop()!
      .replace(/\.(md|csv)$/, '')
    const body = isCsv
      ? `<h1>${escape(title)}</h1>${csvTable(file.markdown)}`
      : toHtmlLinks(md.render(file.markdown))
    entries[file.path.replace(/\.(md|csv)$/, '.html')] = strToU8(page(title, body))
  }
  for (const a of attachments) entries[a.path] = [a.bytes, { level: 0 }]
  const title = pageId ? safeName(repo.get(pageId)?.title ?? '') : 'Notionix'
  const only = Object.keys(entries)
  if (only.length === 1)
    return { fileName: `${title}.html`, bytes: entries[only[0]] as Uint8Array, pages: 1 }
  return {
    fileName: `${title} (HTML).zip`,
    bytes: zipSync(entries, { level: 6 }),
    pages: files.length
  }
}
