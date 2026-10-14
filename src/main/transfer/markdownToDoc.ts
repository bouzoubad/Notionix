import MarkdownIt, { type Token } from 'markdown-it'

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
  tablesFlattened: number
  imagesIgnored: number
}

export const newStats = (): ConversionStats => ({
  linksResolved: 0,
  linksUnresolved: 0,
  tablesFlattened: 0,
  imagesIgnored: 0
})

/**
 * Maps a link found in a page to the href of an imported page. Returns
 * undefined for links that do not point to imported content.
 */
export type LinkResolver = (href: string) => string | undefined

const SAFE_SCHEME = /^(https?|mailto|tel):/i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i

const md = new MarkdownIt({ html: true, linkify: false }).enable(['table', 'strikethrough'])

const text = (value: string, marks: JsonMark[] = []): JsonNode => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks } : {})
})
const paragraph = (content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const emptyParagraph = (): JsonNode => ({ type: 'paragraph' })

/**
 * Converts Markdown (as exported by Notion) to a ProseMirror document using
 * the node and mark names of the editor schema. Constructs the editor has no
 * block for (tables, toggles, images) degrade to text and are counted in `stats`.
 */
export function markdownToDoc(
  source: string,
  resolve: LinkResolver,
  stats: ConversionStats
): JsonNode {
  const tokens = md.parse(source, {})
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
          const content = this.inline(this.tokens[i + 1])
          out.push({ type: 'heading', attrs: { level }, content })
          i += 3
          break
        }
        case 'paragraph_open': {
          const content = this.inline(this.tokens[i + 1])
          if (content.length) out.push(paragraph(content))
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
        case 'hr':
          out.push({ type: 'horizontalRule' })
          i += 1
          break
        case 'table_open': {
          const [rows, end] = this.table(i)
          out.push(...rows)
          this.stats.tablesFlattened += 1
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

  /** Tables have no block in the editor: each row becomes a paragraph of " | " separated cells. */
  private table(start: number): [JsonNode[], number] {
    const rows: JsonNode[] = []
    let i = start + 1
    let cells: JsonNode[] = []
    let header = false
    while (i < this.tokens.length && this.tokens[i].type !== 'table_close') {
      const t = this.tokens[i]
      if (t.type === 'tr_open') {
        cells = []
        header = false
      } else if (t.type === 'th_open' || t.type === 'td_open') {
        header = t.type === 'th_open'
        const inline = this.inline(this.tokens[i + 1])
        if (cells.length) cells.push(text(' | '))
        cells.push(...(header ? inline.map(bolden) : inline))
      } else if (t.type === 'tr_close' && cells.length) {
        rows.push(paragraph(cells))
      }
      i += 1
    }
    return [rows, i]
  }

  private htmlBlock(index: number, out: JsonNode[]): number {
    const html = this.tokens[index].content
    const trimmed = html.trimStart()
    if (/^<aside\b/i.test(trimmed)) {
      const inner = html.replace(/^\s*<aside[^>]*>/i, '')
      if (/<\/aside>/i.test(inner)) {
        // The whole callout is in this block.
        pushInlineText(out, inner.replace(/<\/aside>\s*$/i, ''), this)
        return index + 1
      }
      pushInlineText(out, inner, this)
      const [children, end] = this.blocks(
        index + 1,
        (t) => t.type === 'html_block' && /<\/aside>/i.test(t.content)
      )
      const quote = [...out.splice(out.length - (inner.trim() ? 1 : 0)), ...children]
      out.push({ type: 'blockquote', content: quote.length ? quote : [emptyParagraph()] })
      return end + 1
    }
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(html)
    if (summary) {
      // Toggles have no block in the editor: the summary becomes a bold line, the body follows it.
      const inline = md.parseInline(summary[1].trim(), {})[0]?.children ?? []
      const content = this.inlineTokens(inline)
      if (content.length) out.push(paragraph(content.map(bolden)))
    }
    pushInlineText(out, html.replace(/<summary[^>]*>[\s\S]*?<\/summary>/gi, ''), this)
    return index + 1
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
        case 'image':
          this.stats.imagesIgnored += 1
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

const bolden = (node: JsonNode): JsonNode =>
  node.type === 'text' ? { ...node, marks: [...(node.marks ?? []), { type: 'bold' }] } : node

/** Appends the plain text of an HTML fragment, with its tags removed, as a paragraph. */
function pushInlineText(out: JsonNode[], html: string, converter: Converter): void {
  const plain = html.replace(/<[^>]+>/g, '').trim()
  if (!plain) return
  const inline = md.parseInline(plain, {})[0]?.children ?? []
  const content = converter.inlineTokens(inline)
  if (content.length) out.push(paragraph(content))
}

const TASK_MARKER = /^\[([ xX])\]\s+/

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
