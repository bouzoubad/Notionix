/** Scheme serving images stored by Notionix: notionix-asset://file/<sha256>.<ext> */
export const ASSET_SCHEME = 'notionix-asset'

export type AssetKind = 'image' | 'video' | 'audio' | 'file'

/**
 * Files Notionix keeps, by extension. Pages are never served from here: no
 * HTML or script types. `inline` files may be shown in the page.
 */
export const ASSET_TYPES: Record<string, { mime: string; kind: AssetKind; inline: boolean }> = {
  png: { mime: 'image/png', kind: 'image', inline: true },
  jpg: { mime: 'image/jpeg', kind: 'image', inline: true },
  gif: { mime: 'image/gif', kind: 'image', inline: true },
  webp: { mime: 'image/webp', kind: 'image', inline: true },
  svg: { mime: 'image/svg+xml', kind: 'image', inline: true },
  avif: { mime: 'image/avif', kind: 'image', inline: true },
  bmp: { mime: 'image/bmp', kind: 'image', inline: true },
  mp4: { mime: 'video/mp4', kind: 'video', inline: true },
  webm: { mime: 'video/webm', kind: 'video', inline: true },
  mov: { mime: 'video/quicktime', kind: 'video', inline: true },
  m4v: { mime: 'video/mp4', kind: 'video', inline: true },
  mp3: { mime: 'audio/mpeg', kind: 'audio', inline: true },
  wav: { mime: 'audio/wav', kind: 'audio', inline: true },
  ogg: { mime: 'audio/ogg', kind: 'audio', inline: true },
  m4a: { mime: 'audio/mp4', kind: 'audio', inline: true },
  flac: { mime: 'audio/flac', kind: 'audio', inline: true },
  pdf: { mime: 'application/pdf', kind: 'file', inline: true },
  txt: { mime: 'text/plain; charset=utf-8', kind: 'file', inline: false },
  md: { mime: 'text/markdown; charset=utf-8', kind: 'file', inline: false },
  csv: { mime: 'text/csv; charset=utf-8', kind: 'file', inline: false },
  json: { mime: 'application/json', kind: 'file', inline: false },
  rtf: { mime: 'application/rtf', kind: 'file', inline: false },
  doc: { mime: 'application/msword', kind: 'file', inline: false },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'file',
    inline: false
  },
  xls: { mime: 'application/vnd.ms-excel', kind: 'file', inline: false },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'file',
    inline: false
  },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'file', inline: false },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'file',
    inline: false
  },
  odt: { mime: 'application/vnd.oasis.opendocument.text', kind: 'file', inline: false },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'file', inline: false },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', kind: 'file', inline: false },
  zip: { mime: 'application/zip', kind: 'file', inline: false },
  '7z': { mime: 'application/x-7z-compressed', kind: 'file', inline: false },
  gz: { mime: 'application/gzip', kind: 'file', inline: false },
  tar: { mime: 'application/x-tar', kind: 'file', inline: false }
}

export const ASSET_NAME = new RegExp(`^[0-9a-f]{64}\\.(${Object.keys(ASSET_TYPES).join('|')})$`)

/** Extension of a file name when Notionix keeps that type, else null. */
export function assetExtension(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const normalized = ext === 'jpeg' ? 'jpg' : ext
  return Object.hasOwn(ASSET_TYPES, normalized) ? normalized : null
}

export const assetKind = (name: string): AssetKind =>
  ASSET_TYPES[name.split('.').pop() ?? '']?.kind ?? 'file'

export const assetSrc = (name: string): string => `${ASSET_SCHEME}://file/${name}`

/** Stored file name of an asset src, or null when `src` is not a Notionix asset. */
export function assetNameFromSrc(src: string): string | null {
  const prefix = `${ASSET_SCHEME}://file/`
  if (!src.startsWith(prefix)) return null
  const name = src.slice(prefix.length)
  return ASSET_NAME.test(name) ? name : null
}

/** Where the web client loads a stored image from (the server checks the session). */
export const assetWebPath = (name: string): string => `/api/assets/${name}`

/** Stored src of an image shown by the web client, or `url` unchanged for any other image. */
export function assetSrcFromWebPath(url: string): string {
  const match = /^(?:https?:\/\/[^/]+)?\/api\/assets\/([^/?#]+)$/.exec(url)
  const name = match ? decodeURIComponent(match[1]) : ''
  return ASSET_NAME.test(name) ? assetSrc(name) : url
}

const EXTENSIONS: Record<string, string> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  gif: 'gif',
  webp: 'webp',
  svg: 'svg',
  avif: 'avif',
  bmp: 'bmp'
}

/**
 * Image type from the file's first bytes; only SVG (text) also needs its name.
 * Shared by the app and the collaboration server, which both accept images.
 */
export function detectImageType(bytes: Uint8Array, name: string): string | null {
  const b = bytes
  const ascii = (start: number, text: string): boolean =>
    [...text].every((c, i) => b[start + i] === c.charCodeAt(0))
  if (b[0] === 0x89 && ascii(1, 'PNG')) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (ascii(0, 'GIF8')) return 'gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp'
  if (ascii(4, 'ftypavif') || ascii(4, 'ftypavis')) return 'avif'
  if (ascii(0, 'BM')) return 'bmp'
  if (EXTENSIONS[name.split('.').pop()?.toLowerCase() ?? ''] === 'svg') {
    const head = new TextDecoder().decode(b.subarray(0, 1024))
    if (/<svg[\s>]/i.test(head)) return 'svg'
  }
  return null
}
