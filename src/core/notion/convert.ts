import { randomUUID } from 'crypto'
import { pageLinkHref } from '../../shared/editorExtensions'
import { isBlockColor } from '../../shared/colors'
import type { JsonMark, JsonNode } from '../transfer/markdownToDoc'
import type { NotionBlock, NotionBlockData, NotionDate, NotionIcon, NotionRichText } from './types'

/** What the conversion of a page needs to know about the rest of the migration. */
export interface ConvertContext {
  /** Notionix id of a migrated Notion page or database, else null */
  pageId(notionId: string): string | null
  /** Notionix account of a Notion user (by e-mail), else null */
  userId(notionUserId: string): string | null
  userName(notionUserId: string): string
  /** Stores a Notion file; null when it could not be kept */
  asset(url: string, name?: string): Promise<{ src: string; name: string; size: number } | null>
  /** A team emoji (Notion custom emoji) by its Notion id or name */
  emoji(ref: {
    id?: string
    name?: string
    url?: string
  }): Promise<{ name: string; src: string } | null>
  /** Inline (shown in the page) Notion database */
  isInlineDatabase(notionId: string): boolean
  /**
   * The hidden page of a synced block, made once from the original's
   * children (or a copy's, when the original is not shared with the migration)
   */
  synced(originalBlockId: string, children: NotionBlock[]): Promise<string>
  /** Time zone of dates written with a time */
  timeZone: string
  /** Counts what could not be carried over (report) */
  note(what: string): void
}

const COLORS = new Set([
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red'
])

/** Notion's color name ('red', 'red_background', 'default') as a Notionix block color. */
export function blockColor(color: string | undefined): string | null {
  if (!color || color === 'default') return null
  return isBlockColor(color) ? color : null
}

function colorMark(color: string | undefined): JsonMark | null {
  if (!color || color === 'default') return null
  const background = color.endsWith('_background')
  const name = background ? color.slice(0, -'_background'.length) : color
  if (!COLORS.has(name)) return null
  return {
    type: 'textStyle',
    attrs: background
      ? { color: null, backgroundColor: `var(--nx-${name}-bg)` }
      : { color: `var(--nx-${name})`, backgroundColor: null }
  }
}

const NOTION_ID = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?![0-9a-f])/i

/** The Notion id a link points to (a page of the workspace), if any. */
export function notionIdOfLink(href: string): string | null {
  if (!/^(\/|https?:\/\/([\w-]+\.)?notion\.(so|site|com)\/)/i.test(href)) return null
  const path = href.replace(/[?#].*$/, '')
  const m = NOTION_ID.exec(path.split('/').pop() ?? '')
  return m ? toUuid(m[1]) : null
}

export const toUuid = (id: string): string => {
  const hex = id.replace(/-/g, '').toLowerCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A Notion date or date-time as Notionix writes dates: local 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'. */
export function localDate(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function notionDate(date: NotionDate, timeZone: string): { start: string; end?: string } {
  const zone = date.time_zone || timeZone
  const start = localDate(date.start, zone)
  const end = date.end ? localDate(date.end, zone) : null
  return end && end >= start ? { start, end } : { start }
}

export const plainText = (text: NotionRichText[] | undefined): string =>
  (text ?? []).map((t) => t.plain_text).join('')

/** Notion rich text as inline nodes of the shared schema. */
export async function richText(
  items: NotionRichText[] | undefined,
  ctx: ConvertContext,
  options: { textOnly?: boolean } = {}
): Promise<JsonNode[]> {
  const out: JsonNode[] = []
  const pushText = (text: string, marks: JsonMark[]): void => {
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (i > 0) out.push(options.textOnly ? { type: 'text', text: ' ' } : { type: 'hardBreak' })
      if (line)
        out.push(marks.length ? { type: 'text', text: line, marks } : { type: 'text', text: line })
    })
  }
  for (const item of items ?? []) {
    const a = item.annotations ?? {}
    const marks: JsonMark[] = []
    if (a.code) {
      // Inline code excludes every other mark in the editor.
      marks.push({ type: 'code' })
    } else {
      if (a.bold) marks.push({ type: 'bold' })
      if (a.italic) marks.push({ type: 'italic' })
      if (a.strikethrough) marks.push({ type: 'strike' })
      if (a.underline) marks.push({ type: 'underline' })
      const color = colorMark(a.color)
      if (color) marks.push(color)
      const href = item.href ?? item.text?.link?.url ?? null
      if (href && item.type === 'text') {
        const target = notionIdOfLink(href)
        const page = target ? ctx.pageId(target) : null
        if (page) marks.push({ type: 'link', attrs: { href: pageLinkHref(page) } })
        else if (/^(https?|mailto|tel):/i.test(href)) marks.push({ type: 'link', attrs: { href } })
      }
    }
    if (item.type === 'equation' && item.equation && !options.textOnly) {
      out.push({ type: 'inlineMath', attrs: { latex: item.equation.expression } })
      continue
    }
    if (item.type === 'mention' && item.mention && !options.textOnly) {
      const node = await mention(item, ctx)
      if (node) {
        out.push(node)
        continue
      }
    }
    if (item.type === 'mention' && item.mention?.type === 'link_preview' && !a.code) {
      marks.push({ type: 'link', attrs: { href: item.mention.link_preview!.url } })
    }
    if (item.type === 'mention' && item.mention?.type === 'link_mention' && !a.code) {
      marks.push({ type: 'link', attrs: { href: item.mention.link_mention!.href } })
    }
    pushText(item.plain_text, marks)
  }
  return out
}

async function mention(item: NotionRichText, ctx: ConvertContext): Promise<JsonNode | null> {
  const m = item.mention!
  switch (m.type) {
    case 'user': {
      const id = m.user ? ctx.userId(m.user.id) : null
      if (!id) return null
      return {
        type: 'mention',
        attrs: {
          kind: 'user',
          id,
          label: m.user?.name ?? item.plain_text.replace(/^@/, ''),
          date: null,
          reminder: false
        }
      }
    }
    case 'page':
    case 'database':
    case 'data_source': {
      const ref = m.page?.id ?? m.database?.id ?? m.data_source?.id
      const id = ref ? ctx.pageId(ref) : null
      if (!id) return null
      return {
        type: 'mention',
        attrs: { kind: 'page', id, label: item.plain_text, date: null, reminder: false }
      }
    }
    case 'date': {
      if (!m.date?.start) return null
      const date = notionDate(m.date, ctx.timeZone)
      return {
        type: 'mention',
        attrs: {
          kind: 'date',
          id: randomUUID(),
          label: item.plain_text,
          date: date.start,
          reminder: false
        }
      }
    }
    case 'custom_emoji': {
      const emoji = m.custom_emoji ? await ctx.emoji(m.custom_emoji) : null
      return emoji ? { type: 'customEmoji', attrs: { name: emoji.name, src: emoji.src } } : null
    }
    default:
      return null
  }
}

const data = (block: NotionBlock): NotionBlockData =>
  (block[block.type] as NotionBlockData | undefined) ?? {}

const paragraph = (content: JsonNode[], color: string | null = null): JsonNode => ({
  type: 'paragraph',
  ...(color ? { attrs: { blockColor: color } } : {}),
  ...(content.length ? { content } : {})
})

const LIST_TYPES: Record<string, { list: string; item: string }> = {
  bulleted_list_item: { list: 'bulletList', item: 'listItem' },
  numbered_list_item: { list: 'orderedList', item: 'listItem' },
  to_do: { list: 'taskList', item: 'taskItem' }
}

/** Notion blocks (with their children filled by the crawler) as block nodes of the shared schema. */
export async function convertBlocks(
  blocks: NotionBlock[],
  ctx: ConvertContext
): Promise<JsonNode[]> {
  const out: JsonNode[] = []
  let list: JsonNode | null = null
  let listType = ''
  for (const block of blocks) {
    if (block.in_trash || block.archived) continue
    const kind = LIST_TYPES[block.type]
    if (kind) {
      const d = data(block)
      if (!list || listType !== block.type) {
        list = { type: kind.list, content: [] }
        if (block.type === 'numbered_list_item' && d.list_start_index && d.list_start_index > 1)
          list.attrs = { start: d.list_start_index }
        listType = block.type
        out.push(list)
      }
      const color = blockColor(d.color)
      if (color && !list.attrs?.blockColor) list.attrs = { ...list.attrs, blockColor: color }
      const item: JsonNode = {
        type: kind.item,
        content: [
          paragraph(await richText(d.rich_text, ctx)),
          ...(await convertBlocks(block.children ?? [], ctx))
        ]
      }
      if (block.type === 'to_do') item.attrs = { checked: d.checked === true }
      list.content!.push(item)
      continue
    }
    list = null
    listType = ''
    out.push(...(await convertBlock(block, ctx)))
  }
  return out
}

const LANGUAGES: Record<string, string> = {
  'plain text': 'plaintext',
  'c++': 'cpp',
  'c#': 'csharp',
  'f#': 'fsharp',
  shell: 'bash',
  'objective-c': 'objectivec',
  'vb.net': 'vbnet',
  'visual basic': 'vbnet',
  'java/c/c++/c#': 'java',
  docker: 'dockerfile',
  markup: 'xml',
  html: 'xml',
  mermaid: 'plaintext',
  webassembly: 'wasm'
}

async function convertBlock(block: NotionBlock, ctx: ConvertContext): Promise<JsonNode[]> {
  const d = data(block)
  const color = blockColor(d.color)
  const children = async (): Promise<JsonNode[]> => convertBlocks(block.children ?? [], ctx)
  const caption = async (): Promise<JsonNode[]> => {
    const text = await richText(d.caption, ctx)
    return text.length
      ? [
          paragraph(
            text.map((n) =>
              n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), { type: 'italic' }] } : n
            )
          )
        ]
      : []
  }
  switch (block.type) {
    case 'paragraph': {
      const kids = await children()
      return [paragraph(await richText(d.rich_text, ctx), color), ...kids]
    }
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'heading_4': {
      const level = Number(block.type.slice(-1))
      if (d.is_toggleable) {
        return [
          {
            type: 'details',
            attrs: {
              headingLevel: Math.min(level, 3),
              open: false,
              ...(color ? { blockColor: color } : {})
            },
            content: [
              {
                type: 'detailsSummary',
                content: await richText(d.rich_text, ctx, { textOnly: true })
              },
              { type: 'detailsContent', content: nonEmpty(await children()) }
            ]
          }
        ]
      }
      return [
        {
          type: 'heading',
          attrs: { level, ...(color ? { blockColor: color } : {}) },
          content: await richText(d.rich_text, ctx)
        },
        ...(await children())
      ]
    }
    case 'toggle':
      return [
        {
          type: 'details',
          attrs: { open: false, ...(color ? { blockColor: color } : {}) },
          content: [
            {
              type: 'detailsSummary',
              content: await richText(d.rich_text, ctx, { textOnly: true })
            },
            { type: 'detailsContent', content: nonEmpty(await children()) }
          ]
        }
      ]
    case 'quote':
      return [
        {
          type: 'blockquote',
          ...(color ? { attrs: { blockColor: color } } : {}),
          content: [paragraph(await richText(d.rich_text, ctx)), ...(await children())]
        }
      ]
    case 'callout':
      return [
        {
          type: 'callout',
          attrs: {
            icon: calloutIcon(d.icon ?? null, ctx),
            ...(color ? { blockColor: color } : {})
          },
          content: [paragraph(await richText(d.rich_text, ctx)), ...(await children())]
        }
      ]
    case 'code': {
      const language = (d.language ?? '').toLowerCase()
      const text = plainText(d.rich_text)
      return [
        {
          type: 'codeBlock',
          attrs: { language: LANGUAGES[language] ?? (language || null) },
          ...(text ? { content: [{ type: 'text', text }] } : {})
        },
        ...(await caption())
      ]
    }
    case 'equation':
      return [{ type: 'blockMath', attrs: { latex: d.expression ?? '' } }]
    case 'divider':
      return [{ type: 'horizontalRule' }]
    case 'table_of_contents':
      return [{ type: 'tableOfContents' }]
    case 'breadcrumb':
      return []
    case 'image': {
      const url = d.type === 'file' ? d.file?.url : d.external?.url
      const stored = url ? await ctx.asset(url, d.name) : null
      if (!stored) {
        ctx.note('Image non récupérée (lien gardé)')
        return url ? [linkParagraph(plainText(d.caption) || url, url)] : []
      }
      const alt = plainText(d.caption) || null
      return [{ type: 'image', attrs: { src: stored.src, alt } }, ...(await caption())]
    }
    case 'file':
    case 'pdf':
    case 'video':
    case 'audio': {
      if (d.type !== 'file') {
        const url = d.external?.url
        return url ? [linkParagraph(plainText(d.caption) || d.name || url, url)] : []
      }
      const stored = d.file?.url ? await ctx.asset(d.file.url, d.name) : null
      if (!stored) {
        ctx.note('Fichier non récupéré')
        return [
          paragraph([{ type: 'text', text: `Fichier non récupéré : ${d.name ?? ''}`.trim() }])
        ]
      }
      const media = block.type === 'video' || block.type === 'audio'
      const playable =
        (block.type === 'video' && /\.(mp4|webm|mov|m4v)$/i.test(stored.src)) ||
        (block.type === 'audio' && /\.(mp3|wav|ogg|m4a|flac)$/i.test(stored.src))
      return [
        media && playable
          ? { type: block.type, attrs: { src: stored.src } }
          : { type: 'fileBlock', attrs: { src: stored.src, name: stored.name, size: stored.size } },
        ...(await caption())
      ]
    }
    case 'bookmark':
    case 'embed':
    case 'link_preview': {
      const url = d.url
      return url ? [linkParagraph(plainText(d.caption) || url, url)] : []
    }
    case 'table':
      return [await table(block, ctx)]
    case 'column_list': {
      const columns: JsonNode[][] = []
      for (const column of block.children ?? []) {
        if (column.type !== 'column') continue
        columns.push(nonEmpty(await convertBlocks(column.children ?? [], ctx)))
      }
      if (columns.length === 0) return []
      if (columns.length === 1) return columns[0]
      // The editor holds 2 to 5 columns: further ones go into the fifth.
      while (columns.length > 5) columns[4].push(...columns.splice(5, 1)[0])
      return [
        {
          type: 'columns',
          content: columns.map((content) => ({ type: 'column', content }))
        }
      ]
    }
    case 'child_page': {
      const id = ctx.pageId(block.id)
      return id ? [{ type: 'pageLink', attrs: { pageId: id } }] : []
    }
    case 'child_database': {
      const id = ctx.pageId(block.id)
      if (!id) return []
      return ctx.isInlineDatabase(block.id)
        ? [{ type: 'databaseView', attrs: { databaseId: id } }]
        : [{ type: 'pageLink', attrs: { pageId: id } }]
    }
    case 'link_to_page': {
      const ref = d.page_id ?? d.database_id ?? d.data_source_id
      const id = ref ? ctx.pageId(ref) : null
      return id ? [{ type: 'pageLink', attrs: { pageId: id } }] : []
    }
    case 'synced_block': {
      const original = d.synced_from?.block_id ?? block.id
      const sourceId = await ctx.synced(original, block.children ?? [])
      return [{ type: 'syncedBlock', attrs: { sourceId } }]
    }
    case 'template':
    case 'button':
      ctx.note(`Bloc « ${block.type} » non repris`)
      return []
    default: {
      ctx.note(`Bloc « ${block.type} » non pris en charge`)
      const text = d.rich_text ? await richText(d.rich_text, ctx) : []
      const kids = await children()
      return text.length || kids.length ? [paragraph(text), ...kids] : []
    }
  }
}

async function table(block: NotionBlock, ctx: ConvertContext): Promise<JsonNode> {
  const d = data(block)
  const rows: JsonNode[] = []
  const width = Math.max(1, d.table_width ?? 1)
  for (const [r, row] of (block.children ?? []).filter((c) => c.type === 'table_row').entries()) {
    const cells = (data(row).cells ?? []) as NotionRichText[][]
    const content: JsonNode[] = []
    for (let c = 0; c < width; c += 1) {
      const header = (d.has_column_header && r === 0) || (d.has_row_header && c === 0)
      content.push({
        type: header ? 'tableHeader' : 'tableCell',
        content: [paragraph(await richText(cells[c] ?? [], ctx))]
      })
    }
    rows.push({ type: 'tableRow', content })
  }
  if (rows.length === 0)
    rows.push({ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph([])] }] })
  return { type: 'table', content: rows }
}

const nonEmpty = (blocks: JsonNode[]): JsonNode[] => (blocks.length ? blocks : [paragraph([])])

const linkParagraph = (text: string, href: string): JsonNode =>
  /^(https?|mailto):/i.test(href)
    ? paragraph([{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }])
    : paragraph([{ type: 'text', text }])

/** A callout shows an emoji only: Notion's other icons fall back to the default one. */
function calloutIcon(icon: NotionIcon | null, ctx: ConvertContext): string {
  if (icon?.type === 'emoji') return icon.emoji
  if (icon) ctx.note('Icône de callout remplacée par 💡')
  return '💡'
}
