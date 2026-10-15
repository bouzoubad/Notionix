/** Scheme serving images stored by Notionix: notionix-asset://file/<sha256>.<ext> */
export const ASSET_SCHEME = 'notionix-asset'

export const ASSET_NAME = /^[0-9a-f]{64}\.(png|jpg|gif|webp|svg|avif|bmp)$/

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
