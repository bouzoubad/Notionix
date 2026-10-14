import { createHash } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { ASSET_NAME, assetNameFromSrc, assetSrc, detectImageType } from '../shared/assets'

export const MAX_ASSET_BYTES = 50 * 1024 * 1024

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
