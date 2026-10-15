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
