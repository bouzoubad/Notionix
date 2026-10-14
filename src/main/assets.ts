import { createHash } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { ASSET_NAME, assetNameFromSrc, assetSrc } from '../shared/assets'

export const MAX_ASSET_BYTES = 50 * 1024 * 1024

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

/** Image type from the file's first bytes; falls back to the name only for SVG (text). */
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
  const ext = EXTENSIONS[name.split('.').pop()?.toLowerCase() ?? '']
  if (ext === 'svg') {
    const head = Buffer.from(b.subarray(0, 1024)).toString('utf8')
    if (/<svg[\s>]/i.test(head)) return 'svg'
  }
  return null
}

/**
 * Content-addressed image store under the user data folder. The same bytes
 * are stored once; files are never modified after being written.
 */
export class AssetStore {
  constructor(private readonly dir: string) {}

  /** Stores an image and returns its src; throws when the bytes are not a supported image. */
  async save(bytes: Uint8Array, nameHint: string): Promise<string> {
    if (bytes.byteLength > MAX_ASSET_BYTES)
      throw new Error(`Image trop volumineuse (max ${MAX_ASSET_BYTES / 1024 / 1024} Mo).`)
    const type = detectImageType(bytes, nameHint)
    if (!type) throw new Error(`Format d'image non pris en charge : ${nameHint}`)
    const name = `${createHash('sha256').update(bytes).digest('hex')}.${type}`
    const target = join(this.dir, name)
    if (!existsSync(target)) {
      await mkdir(this.dir, { recursive: true })
      const temp = `${target}.${process.pid}.tmp`
      await writeFile(temp, bytes)
      await rename(temp, target)
    }
    return assetSrc(name)
  }

  /** Absolute path of a stored asset, or null for an invalid or unknown name. */
  pathOf(name: string): string | null {
    if (!ASSET_NAME.test(name)) return null
    const path = join(this.dir, name)
    return existsSync(path) ? path : null
  }

  async read(src: string): Promise<Uint8Array | null> {
    const name = assetNameFromSrc(src)
    const path = name ? this.pathOf(name) : null
    return path ? new Uint8Array(await readFile(path)) : null
  }
}
