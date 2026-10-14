import { pageIdFromHref } from '../../shared/editorExtensions'
import type { JsonMark, JsonNode } from './markdownToDoc'

/** Resolves the target page of an internal link to a path relative to the exported file, or null. */
export type PageLinkResolver = (pageId: string) => string | null
/** Resolves a stored image (notionix-asset://…) to a path relative to the exported file, or null. */
export type ImageResolver = (src: string) => string | null

interface Resolvers {
  page: PageLinkResolver
  image: ImageResolver
}

const INLINE_ESCAPE = /([\\`*_[\]<>~])/g
const BLOCK_START = /^(\s*)([#>+-]|\d+[.)])(?=\s|$)/
const BULLET_LISTS = new Set(['bulletList', 'taskList'])

/**
 * Serialises an editor document to Markdown that Notion's importer and any
 * CommonMark reader can read. Callouts and toggles use Notion's own
 * <aside> and <details> layout.
 */
export function docToMarkdown(
  doc: JsonNode,
  linkTo: PageLinkResolver = () => null,
  imageTo: ImageResolver = () => null
): string {
  return blocks(doc.content ?? [], { page: linkTo, image: imageTo })
    .join('\n\n')
    .trimEnd()
}

/**
 * Two lists of the same kind in a row would be read back as one, so the second
 * one uses the other bullet character (or ordered-list delimiter).
 */
function blocks(nodes: JsonNode[], r: Resolvers): string[] {
  const out: string[] = []
  let previous: JsonNode | null = null
  let alternate = false
  for (const node of nodes) {
    const sameKind =
      previous !== null &&
      ((BULLET_LISTS.has(previous.type) && BULLET_LISTS.has(node.type)) ||
        (previous.type === 'orderedList' && node.type === 'orderedList'))
    alternate = sameKind ? !alternate : false
    const text = block(node, r, alternate)
    if (text !== '') out.push(text)
    previous = node
  }
  return out
}

function block(node: JsonNode, r: Resolvers, alternate = false): string {
  const bullet = alternate ? '*' : '-'
  switch (node.type) {
    case 'paragraph':
      return escapeBlockStart(inline(node.content ?? [], r))
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${inline(node.content ?? [], r)}`
    }
    case 'bulletList':
      return (node.content ?? []).map((item) => listItem(`${bullet} `, item, r)).join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1)
      const delimiter = alternate ? ')' : '.'
      return (node.content ?? [])
        .map((item, i) => listItem(`${start + i}${delimiter} `, item, r))
        .join('\n')
    }
    case 'taskList':
      return (node.content ?? [])
        .map((item) => listItem(`${bullet} [${item.attrs?.checked ? 'x' : ' '}] `, item, r))
        .join('\n')
    case 'blockquote':
      return quote(blocks(node.content ?? [], r).join('\n\n'))
    case 'codeBlock': {
      const code = (node.content ?? []).map((n) => n.text ?? '').join('')
      const fence = '`'.repeat(Math.max(3, longestRun(code, '`') + 1))
      return `${fence}${node.attrs?.language ?? ''}\n${code}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    case 'image': {
      const src = String(node.attrs?.src ?? '')
      const path = /^https?:\/\//i.test(src) ? encodeHref(src) : r.image(src)
      if (!path) return ''
      const alt = String(node.attrs?.alt ?? '').replace(/[[\]\\]/g, '\\$&')
      return `![${alt}](${path})`
    }
    case 'table':
      return table(node, r)
    case 'callout': {
      // Notion's layout: the icon opens the first line inside <aside>.
      const icon = String(node.attrs?.icon ?? '')
      const children = node.content ?? []
      const first = children[0]?.type === 'paragraph' ? inline(children[0].content ?? [], r) : null
      const rest = blocks(first === null ? children : children.slice(1), r)
      const head = [icon, first ?? ''].filter(Boolean).join(' ')
      const body = rest.length ? ['', rest.join('\n\n')] : []
      return ['<aside>', head, ...body, '', '</aside>'].join('\n')
    }
    case 'details': {
      const summary = node.content?.find((n) => n.type === 'detailsSummary')
      const body = node.content?.find((n) => n.type === 'detailsContent')
      const title = escapeHtml((summary?.content ?? []).map((n) => n.text ?? '').join(''))
      const inner = blocks(body?.content ?? [], r).join('\n\n')
      return ['<details>', `<summary>${title}</summary>`, '', inner, '', '</details>'].join('\n')
    }
    default:
      return inline(node.content ?? [], r)
  }
}

const quote = (text: string): string =>
  text
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')

/** GFM table; the first row is the header row, as Markdown requires one. */
function table(node: JsonNode, r: Resolvers): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((b) => (b.type === 'paragraph' ? inline(b.content ?? [], r) : block(b, r)))
        .join('<br>')
        .replace(/ {2}\n/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/\|/g, '\\|')
    )
  )
  if (rows.length === 0) return ''
  const width = Math.max(1, ...rows.map((cells) => cells.length))
  const line = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
  const separator = `| ${Array(width).fill('---').join(' | ')} |`
  return [line(rows[0]), separator, ...rows.slice(1).map(line)].join('\n')
}

/** First block after the marker, the others indented under it. */
function listItem(marker: string, item: JsonNode, r: Resolvers): string {
  const parts = blocks(item.content ?? [], r)
  const indent = ' '.repeat(marker.length)
  const lines = parts.join('\n\n').split('\n')
  const tail = lines
    .slice(1)
    .map((l) => (l ? `\n${indent}${l}` : '\n'))
    .join('')
  return (marker + (lines[0] ?? '')).trimEnd() + tail
}

function inline(nodes: JsonNode[], r: Resolvers): string {
  return nodes.map((n) => inlineNode(n, r)).join('')
}

function inlineNode(node: JsonNode, r: Resolvers): string {
  if (node.type === 'hardBreak') return '  \n'
  if (node.type !== 'text') return inline(node.content ?? [], r)
  const marks = node.marks ?? []
  const raw = node.text ?? ''
  const code = marks.find((m) => m.type === 'code')
  let out = code ? codeSpan(raw) : escapeInline(raw)
  const has = (type: string): boolean => marks.some((m) => m.type === type)
  if (!code) {
    // Emphasis delimiters must hug the text, so surrounding spaces stay outside.
    const lead = /^\s*/.exec(out)![0]
    const trail = /\s*$/.exec(out)![0]
    let core = out.slice(lead.length, out.length - trail.length)
    if (core) {
      if (has('strike')) core = `~~${core}~~`
      if (has('italic')) core = `*${core}*`
      if (has('bold')) core = `**${core}**`
      if (has('underline')) core = `<u>${core}</u>`
    }
    out = lead + core + trail
  }
  const link = marks.find((m) => m.type === 'link')
  return link ? wrapLink(out, link, r) : out
}

function wrapLink(label: string, link: JsonMark, r: Resolvers): string {
  const href = String(link.attrs?.href ?? '')
  const pageId = pageIdFromHref(href)
  if (pageId === null) return `[${label}](${encodeHref(href)})`
  const relative = r.page(pageId)
  return relative === null ? label : `[${label}](${relative})`
}

const encodeHref = (href: string): string => href.replace(/[()\s]/g, (c) => encodeURIComponent(c))

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}
const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => HTML_ENTITIES[c] ?? c)

function codeSpan(text: string): string {
  const fence = '`'.repeat(longestRun(text, '`') + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

const longestRun = (text: string, ch: string): number => {
  let best = 0
  let run = 0
  for (const c of text) {
    run = c === ch ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

const escapeInline = (text: string): string => text.replace(INLINE_ESCAPE, '\\$1')

/** A paragraph that starts like a heading, list or quote would be read as one. */
const escapeBlockStart = (text: string): string => text.replace(BLOCK_START, '$1\\$2')
