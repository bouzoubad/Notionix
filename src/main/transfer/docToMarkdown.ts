import { pageIdFromHref } from '../../shared/editorExtensions'
import type { JsonMark, JsonNode } from './markdownToDoc'

/** Resolves the target page of an internal link to a path relative to the exported file, or null. */
export type PageLinkResolver = (pageId: string) => string | null

const INLINE_ESCAPE = /([\\`*_[\]<>~])/g
const BLOCK_START = /^(\s*)([#>+-]|\d+[.)])(?=\s|$)/

/** Serialises an editor document to Markdown that Notion's importer and any CommonMark reader can read. */
export function docToMarkdown(doc: JsonNode, linkTo: PageLinkResolver = () => null): string {
  return blocks(doc.content ?? [], linkTo)
    .join('\n\n')
    .trimEnd()
}

const BULLET_LISTS = new Set(['bulletList', 'taskList'])

/**
 * Two lists of the same kind in a row would be read back as one, so the second
 * one uses the other bullet character (or ordered-list delimiter).
 */
function blocks(nodes: JsonNode[], linkTo: PageLinkResolver): string[] {
  const out: string[] = []
  let previous: JsonNode | null = null
  let alternate = false
  for (const node of nodes) {
    const sameKind =
      previous !== null &&
      ((BULLET_LISTS.has(previous.type) && BULLET_LISTS.has(node.type)) ||
        (previous.type === 'orderedList' && node.type === 'orderedList'))
    alternate = sameKind ? !alternate : false
    const text = block(node, linkTo, alternate)
    if (text !== '') out.push(text)
    previous = node
  }
  return out
}

function block(node: JsonNode, linkTo: PageLinkResolver, alternate = false): string {
  const bullet = alternate ? '*' : '-'
  switch (node.type) {
    case 'paragraph':
      return escapeBlockStart(inline(node.content ?? [], linkTo))
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${inline(node.content ?? [], linkTo)}`
    }
    case 'bulletList':
      return (node.content ?? []).map((item) => listItem(`${bullet} `, item, linkTo)).join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1)
      return (node.content ?? [])
        .map((item, i) => listItem(`${start + i}. `, item, linkTo))
        .join('\n')
    }
    case 'taskList':
      return (node.content ?? [])
        .map((item) => listItem(`${bullet} [${item.attrs?.checked ? 'x' : ' '}] `, item, linkTo))
        .join('\n')
    case 'blockquote': {
      const inner = blocks(node.content ?? [], linkTo).join('\n\n')
      return inner
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
    }
    case 'codeBlock': {
      const code = (node.content ?? []).map((n) => n.text ?? '').join('')
      const fence = '`'.repeat(Math.max(3, longestRun(code, '`') + 1))
      return `${fence}${node.attrs?.language ?? ''}\n${code}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    default:
      return inline(node.content ?? [], linkTo)
  }
}

/** First block after the marker, the others indented under it. */
function listItem(marker: string, item: JsonNode, linkTo: PageLinkResolver): string {
  const parts = blocks(item.content ?? [], linkTo)
  const indent = ' '.repeat(marker.length)
  const body = parts.join('\n\n')
  const lines = body.split('\n')
  return (
    (marker + (lines[0] ?? '')).trimEnd() +
    lines
      .slice(1)
      .map((l) => (l ? `\n${indent}${l}` : '\n'))
      .join('')
  )
}

function inline(nodes: JsonNode[], linkTo: PageLinkResolver): string {
  return nodes.map((n) => inlineNode(n, linkTo)).join('')
}

function inlineNode(node: JsonNode, linkTo: PageLinkResolver): string {
  if (node.type === 'hardBreak') return '  \n'
  if (node.type !== 'text') return inline(node.content ?? [], linkTo)
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
  return link ? wrapLink(out, link, linkTo) : out
}

function wrapLink(label: string, link: JsonMark, linkTo: PageLinkResolver): string {
  const href = String(link.attrs?.href ?? '')
  const pageId = pageIdFromHref(href)
  if (pageId === null) return `[${label}](${encodeHref(href)})`
  const relative = linkTo(pageId)
  return relative === null ? label : `[${label}](${relative})`
}

const encodeHref = (href: string): string => href.replace(/[()\s]/g, (c) => encodeURIComponent(c))

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
