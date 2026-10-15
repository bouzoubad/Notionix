const NOTION_ID_SUFFIX = /^(.*?)\s+([0-9a-f]{32})$/i

export interface NotionName {
  title: string
  /** Notion page id (32 hex characters) when the name carries one */
  id: string | null
}

/** Splits "Some page 0123…cdef" into its title and Notion id. Names without an id are kept whole. */
export function parseNotionName(stem: string): NotionName {
  const match = NOTION_ID_SUFFIX.exec(stem)
  return match
    ? { title: match[1].trim(), id: match[2].toLowerCase() }
    : { title: stem.trim(), id: null }
}

export const notionSource = (id: string): string => `notion:${id}`

export function splitPath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', base: path } : { dir: path.slice(0, i), base: path.slice(i + 1) }
}

export const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path)
export const isCsv = (path: string): boolean => /\.csv$/i.test(path)

/** Name of a Notion CSV database file without extension or the "_all" suffix of its default view. */
export const csvStem = (base: string): string => base.replace(/\.csv$/i, '').replace(/_all$/i, '')
export const markdownStem = (base: string): string => base.replace(/\.(md|markdown)$/i, '')

/** Resolves `href` (relative, possibly URL-encoded) against the directory `fromDir`, POSIX style. */
export function resolveRelative(fromDir: string, href: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(href.split('#')[0].split('?')[0])
  } catch {
    return null
  }
  if (!decoded) return null
  const parts = decoded.startsWith('/') ? [] : fromDir ? fromDir.split('/') : []
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}
