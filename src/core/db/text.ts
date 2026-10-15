/** Plain text of a ProseMirror JSON document, for full-text search. */
export function docToText(content: string): string {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return ''
  }
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as { text?: string; content?: unknown[] }
    if (typeof node.text === 'string') out.push(node.text)
    node.content?.forEach(walk)
    if (node.content) out.push(' ')
  }
  walk(doc)
  return out.join('').replace(/\s+/g, ' ').trim()
}

const PAGE_HREF = /^notionix:\/\/page\/([A-Za-z0-9_-]{1,64})$/

/**
 * Pages a document points to: links (notionix://page/<id>), page mentions,
 * link-to-page blocks and inline databases.
 */
export function docLinks(content: string): string[] {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return []
  }
  const out = new Set<string>()
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as {
      type?: string
      attrs?: Record<string, unknown>
      marks?: { type?: string; attrs?: Record<string, unknown> }[]
      content?: unknown[]
    }
    for (const m of node.marks ?? []) {
      const href = m.type === 'link' && typeof m.attrs?.href === 'string' ? m.attrs.href : ''
      const match = PAGE_HREF.exec(href)
      if (match) out.add(match[1])
    }
    const a = node.attrs ?? {}
    if (node.type === 'mention' && a.kind === 'page' && typeof a.id === 'string') out.add(a.id)
    if (node.type === 'pageLink' && typeof a.pageId === 'string') out.add(a.pageId)
    if (node.type === 'databaseView' && typeof a.databaseId === 'string') out.add(a.databaseId)
    node.content?.forEach(walk)
  }
  walk(doc)
  return [...out]
}
