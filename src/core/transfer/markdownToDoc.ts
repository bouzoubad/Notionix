import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type Token } from 'markdown-it'

export interface JsonMark {
  type: string
  attrs?: Record<string, unknown>
}
export interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
  marks?: JsonMark[]
}

export interface ConversionStats {
  linksResolved: number
  linksUnresolved: number
}

export const newStats = (): ConversionStats => ({ linksResolved: 0, linksUnresolved: 0 })

/**
 * Maps a link found in a page to the href of an imported page. Returns
 * undefined for links that do not point to imported content.
 */
export type LinkResolver = (href: string) => string | undefined

const SAFE_SCHEME = /^(https?|mailto|tel):/i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i

const md = new MarkdownIt({ html: true, linkify: false }).enable(['table', 'strikethrough'])
md.use(mathPlugin)

/**
 * Notion equations: "$$" lines around a block equation, "$…$" inline. An inline
 * equation cannot start or end with a space, and "$5 and $6" is not one.
 */
function mathPlugin(markdown: MarkdownItInstance): void {
  markdown.block.ruler.before(
    'fence',
    'math_block',
    (state, startLine, endLine, silent) => {
      const lineText = (n: number): string =>
        state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n])
      const first = lineText(startLine).trim()
      if (!first.startsWith('$$')) return false
      let latex: string
      let last = startLine
      if (first.length > 4 && first.endsWith('$$')) {
        latex = first.slice(2, -2)
      } else if (first === '$$') {
        const lines: string[] = []
        let closed = false
        while (++last < endLine) {
          if (lineText(last).trim() === '$$') {
            closed = true
            break
          }
          lines.push(state.src.slice(state.bMarks[last], state.eMarks[last]))
        }
        if (!closed) return false
        latex = lines.join('\n')
      } else {
        return false
      }
      if (silent) return true
      const token = state.push('math_block', 'math', 0)
      token.content = latex.trim()
      token.map = [startLine, last + 1]
      state.line = last + 1
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] }
  )
  markdown.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src
    if (src[state.pos] !== '$' || src[state.pos + 1] === '$') return false
    const start = state.pos + 1
    if (start >= src.length || /\s/.test(src[start])) return false
    let end = start
    while ((end = src.indexOf('$', end)) !== -1 && src[end - 1] === '\\') end += 1
    if (end === -1 || end === start || /\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? '')) {
      return false
    }
    if (!silent) state.push('math_inline', 'math', 0).content = src.slice(start, end)
    state.pos = end + 1
    return true
  })
}

/**
 * Notion writes an empty list item as a bare "-". Right under a line of text,
 * Markdown reads that as a heading underline ("Text" + "-" = heading), so the
 * empty item gets an invisible HTML comment as content.
 */
export function protectEmptyListItems(source: string): string {
  return source.replace(/^([ \t]*[-*+])[ \t]*$/gm, '$1 <!-- -->')
}

/**
 * Notion can break a table row inside a cell (a line break in the cell) and
 * writes "****" for an empty bold header. Rows are joined back with <br>.
 */
export function repairNotionTables(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]
    if (line.trimStart().startsWith('|')) {
      while (
        !line.trimEnd().endsWith('|') &&
        i + 1 < lines.length &&
        !lines[i + 1].trimStart().startsWith('|') &&
        lines[i + 1].trim() !== ''
      ) {
        i += 1
        line = `${line.trimEnd()}<br>${lines[i].trim()}`
      }
      line = line.replace(/\|\s*\*\*\*\*\s*(?=\|)/g, '| ')
    }
    out.push(line)
  }
  return out.join('\n')
}

const text = (value: string, marks: JsonMark[] = []): JsonNode => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks } : {})
})
const paragraph = (content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const emptyParagraph = (): JsonNode => ({ type: 'paragraph' })

/**
 * Converts Markdown (as exported by Notion) to a ProseMirror document using
 * the node and mark names of the editor schema. Notion callouts (<aside>) and
 * toggles (<details>) become callout and details blocks. Images keep their
 * original src; the caller stores the files and rewrites or drops them.
 */
export function markdownToDoc(
  source: string,
  resolve: LinkResolver,
  stats: ConversionStats
): JsonNode {
  const tokens = md.parse(protectEmptyListItems(repairNotionTables(source)), {})
  const converter = new Converter(tokens, resolve, stats)
  const [blocks] = converter.blocks(0, () => false)
  return { type: 'doc', content: blocks.length ? blocks : [emptyParagraph()] }
}

class Converter {
  constructor(
    private readonly tokens: Token[],
    private readonly resolve: LinkResolver,
    private readonly stats: ConversionStats
  ) {}

  /** Parses block tokens from `start` until `isEnd` matches a token; returns the nodes and the end index. */
  blocks(start: number, isEnd: (t: Token) => boolean): [JsonNode[], number] {
    const out: JsonNode[] = []
    let i = start
    while (i < this.tokens.length && !isEnd(this.tokens[i])) {
      const t = this.tokens[i]
      switch (t.type) {
        case 'heading_open': {
          const level = Math.min(6, Math.max(1, Number(t.tag.slice(1)) || 1))
          const content = withoutImages(this.inline(this.tokens[i + 1]))
          out.push({ type: 'heading', attrs: { level }, content })
          i += 3
          break
        }
        case 'paragraph_open': {
          out.push(...splitImages(this.inline(this.tokens[i + 1])))
          i += 3
          break
        }
        case 'bullet_list_open':
        case 'ordered_list_open': {
          const [node, next] = this.list(i)
          out.push(node)
          i = next
          break
        }
        case 'blockquote_open': {
          const [children, end] = this.blocks(i + 1, (x) => x.type === 'blockquote_close')
          out.push({ type: 'blockquote', content: children.length ? children : [emptyParagraph()] })
          i = end + 1
          break
        }
        case 'fence':
        case 'code_block': {
          const language = (t.info ?? '').trim().split(/\s+/)[0] || null
          const code = t.content.replace(/\n$/, '')
          out.push({
            type: 'codeBlock',
            attrs: { language },
            ...(code ? { content: [text(code)] } : {})
          })
          i += 1
          break
        }
        case 'math_block':
          out.push({ type: 'blockMath', attrs: { latex: t.content } })
          i += 1
          break
        case 'hr':
          out.push({ type: 'horizontalRule' })
          i += 1
          break
        case 'table_open': {
          const [table, end] = this.table(i)
          if (table) out.push(table)
          i = end + 1
          break
        }
        case 'html_block': {
          i = this.htmlBlock(i, out)
          break
        }
        default:
          i += 1
      }
    }
    return [out, i]
  }

  private list(start: number): [JsonNode, number] {
    const open = this.tokens[start]
    const ordered = open.type === 'ordered_list_open'
    const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close'
    const items: { children: JsonNode[]; task: boolean | null }[] = []
    let i = start + 1
    while (i < this.tokens.length && this.tokens[i].type !== closeType) {
      if (this.tokens[i].type !== 'list_item_open') {
        i += 1
        continue
      }
      const [children, end] = this.blocks(i + 1, (t) => t.type === 'list_item_close')
      items.push({ children, task: takeTaskMarker(children) })
      i = end + 1
    }
    const allTasks = items.length > 0 && items.every((item) => item.task !== null)
    const content = items.map((item) => {
      const children = item.children.length ? item.children : [emptyParagraph()]
      if (children[0].type !== 'paragraph') children.unshift(emptyParagraph())
      return allTasks
        ? { type: 'taskItem', attrs: { checked: item.task }, content: children }
        : { type: 'listItem', content: children }
    })
    if (!allTasks) restoreTaskMarkers(items)
    const type = allTasks ? 'taskList' : ordered ? 'orderedList' : 'bulletList'
    const attrs =
      ordered && !allTasks ? { start: Number(open.attrGet('start') ?? 1) || 1 } : undefined
    return [
      {
        type,
        ...(attrs ? { attrs } : {}),
        content: content.length ? content : [{ type: 'listItem', content: [emptyParagraph()] }]
      },
      i + 1
    ]
  }

  private table(start: number): [JsonNode | null, number] {
    const rows: JsonNode[] = []
    let cells: JsonNode[] = []
    let i = start + 1
    while (i < this.tokens.length && this.tokens[i].type !== 'table_close') {
      const t = this.tokens[i]
      if (t.type === 'tr_open') {
        cells = []
      } else if (t.type === 'th_open' || t.type === 'td_open') {
        const content = splitImages(this.inline(this.tokens[i + 1]))
        cells.push({
          type: t.type === 'th_open' ? 'tableHeader' : 'tableCell',
          content: content.length ? content : [emptyParagraph()]
        })
      } else if (t.type === 'tr_close' && cells.length) {
        rows.push({ type: 'tableRow', content: cells })
      }
      i += 1
    }
    return [rows.length ? { type: 'table', content: rows } : null, i]
  }

  private htmlBlock(index: number, out: JsonNode[]): number {
    const html = this.tokens[index].content
    const trimmed = html.trimStart()
    if (/^<aside\b/i.test(trimmed)) {
      const inner = html.replace(/^\s*<aside[^>]*>/i, '')
      const closing = /<\/aside>/i.exec(inner)
      let body: JsonNode[]
      let next: number
      if (closing) {
        // The whole callout is in this block (no blank line before the closing tag).
        body = this.htmlParagraph(inner.slice(0, closing.index))
        next = index + 1
        out.push(
          callout(body),
          ...this.htmlParagraph(inner.slice(closing.index + closing[0].length))
        )
        return next
      }
      const [children, end] = this.blocks(
        index + 1,
        (t) => t.type === 'html_block' && /<\/aside>/i.test(t.content)
      )
      body = [...this.htmlParagraph(inner), ...children]
      out.push(callout(body))
      return end + 1
    }
    if (/^<details\b/i.test(trimmed)) {
      const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(html)
      const summaryHtml = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : ''
      const summary = withoutImages(
        this.inlineTokens(md.parseInline(summaryHtml, {})[0]?.children ?? [])
      ).filter((n) => n.type === 'text')
      const rest = html
        .replace(/^\s*<details[^>]*>/i, '')
        .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '')
      const closing = /<\/details>/i.exec(rest)
      let body: JsonNode[]
      let next: number
      if (closing) {
        body = this.htmlParagraph(rest.slice(0, closing.index))
        next = index + 1
      } else {
        const [children, end] = this.blocks(
          index + 1,
          (t) => t.type === 'html_block' && /<\/details>/i.test(t.content)
        )
        body = [...this.htmlParagraph(rest), ...children]
        next = end + 1
      }
      out.push({
        type: 'details',
        content: [
          { type: 'detailsSummary', ...(summary.length ? { content: summary } : {}) },
          { type: 'detailsContent', content: body.length ? body : [emptyParagraph()] }
        ]
      })
      return next
    }
    out.push(...this.htmlParagraph(html))
    return index + 1
  }

  /** The text of an HTML fragment, tags removed, as zero or one paragraph. */
  private htmlParagraph(html: string): JsonNode[] {
    const plain = html.replace(/<[^>]+>/g, '').trim()
    if (!plain) return []
    const content = this.inlineTokens(md.parseInline(plain, {})[0]?.children ?? [])
    return content.length ? [paragraph(content)] : []
  }

  inline(token: Token | undefined): JsonNode[] {
    return token?.children ? this.inlineTokens(token.children) : []
  }

  inlineTokens(children: Token[]): JsonNode[] {
    const out: JsonNode[] = []
    const stack: (JsonMark | null)[] = []
    const active = (): JsonMark[] => stack.filter((m): m is JsonMark => m !== null)
    const push = (value: string, marks: JsonMark[]): void => {
      if (value) out.push(text(value, marks))
    }
    for (const t of children) {
      switch (t.type) {
        case 'text':
          push(t.content, active())
          break
        case 'code_inline':
          // The code mark excludes every other mark.
          push(t.content, [{ type: 'code' }])
          break
        case 'softbreak':
        case 'hardbreak':
          out.push({ type: 'hardBreak' })
          break
        case 'strong_open':
          stack.push({ type: 'bold' })
          break
        case 'em_open':
          stack.push({ type: 'italic' })
          break
        case 's_open':
          stack.push({ type: 'strike' })
          break
        case 'link_open':
          stack.push(this.linkMark(String(t.attrGet('href') ?? '')))
          break
        case 'strong_close':
        case 'em_close':
        case 's_close':
        case 'link_close':
          stack.pop()
          break
        case 'math_inline':
          if (t.content) out.push({ type: 'inlineMath', attrs: { latex: t.content } })
          break
        case 'image':
          out.push({
            type: 'image',
            attrs: { src: String(t.attrGet('src') ?? ''), alt: t.content || null }
          })
          break
        case 'html_inline': {
          const tag = t.content.trim().toLowerCase()
          if (/^<br\s*\/?>$/.test(tag)) out.push({ type: 'hardBreak' })
          else if (tag === '<u>') stack.push({ type: 'underline' })
          else if (tag === '</u>') stack.pop()
          break
        }
        default:
          push(t.content, active())
      }
    }
    return out
  }

  private linkMark(href: string): JsonMark | null {
    const target = this.resolve(href)
    if (target) {
      this.stats.linksResolved += 1
      return { type: 'link', attrs: { href: target } }
    }
    if (SAFE_SCHEME.test(href)) return { type: 'link', attrs: { href } }
    // Other schemes (javascript:, file:…) and fragments are dropped; the text stays.
    if (href.startsWith('#') || ANY_SCHEME.test(href)) return null
    this.stats.linksUnresolved += 1
    return null
  }
}

const withoutImages = (nodes: JsonNode[]): JsonNode[] => nodes.filter((n) => n.type !== 'image')

/** Images are blocks in the editor: a paragraph is split around the images it contains. */
function splitImages(inline: JsonNode[]): JsonNode[] {
  const out: JsonNode[] = []
  let run: JsonNode[] = []
  const flush = (): void => {
    while (run[0]?.type === 'hardBreak') run.shift()
    while (run[run.length - 1]?.type === 'hardBreak') run.pop()
    if (run.some((n) => n.type !== 'text' || n.text?.trim())) out.push(paragraph(run))
    run = []
  }
  for (const node of inline) {
    if (node.type === 'image') {
      flush()
      out.push(node)
    } else {
      run.push(node)
    }
  }
  flush()
  return out
}

const LEADING_EMOJI =
  /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u

/** Notion writes the callout icon as the first characters of its text. */
function callout(body: JsonNode[]): JsonNode {
  let icon: string | undefined
  const first = body[0]?.type === 'paragraph' ? body[0] : undefined
  const head = first?.content?.[0]
  if (head?.type === 'text' && head.text) {
    const match = LEADING_EMOJI.exec(head.text)
    if (match) {
      icon = match[1]
      head.text = head.text.slice(match[0].length)
      if (!head.text) first!.content = first!.content!.slice(1)
      if (!first!.content?.length) body = body.slice(1)
    }
  }
  return {
    type: 'callout',
    ...(icon ? { attrs: { icon } } : {}),
    content: body.length ? body : [emptyParagraph()]
  }
}

// Notion writes an empty to-do as "- [ ]  "; once trimmed only "[ ]" remains.
const TASK_MARKER = /^\[([ xX])\](?:\s+|$)/

/** Returns the checked state when the item starts with "[ ]"/"[x]" and removes the marker; null otherwise. */
function takeTaskMarker(children: JsonNode[]): boolean | null {
  const first = children[0]?.type === 'paragraph' ? children[0].content?.[0] : undefined
  const match = first?.type === 'text' && first.text ? TASK_MARKER.exec(first.text) : null
  if (!match || !first?.text) return null
  const rest = first.text.slice(match[0].length)
  first.text = rest
  if (!rest) children[0].content = children[0].content?.slice(1)
  return match[1] !== ' '
}

/** In a list that is not all tasks, the markers stay as literal text. */
function restoreTaskMarkers(items: { children: JsonNode[]; task: boolean | null }[]): void {
  for (const item of items) {
    if (item.task === null) continue
    const first = item.children[0]
    const marker = `[${item.task ? 'x' : ' '}] `
    const head = first.content?.[0]
    if (head?.type === 'text') head.text = marker + (head.text ?? '')
    else first.content = [text(marker.trimEnd()), ...(first.content ?? [])]
  }
}
