import { createHash } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  ASSET_NAME,
  ASSET_TYPES,
  assetExtension,
  assetNameFromSrc,
  assetSrc,
  detectImageType
} from '../shared/assets'

export const MAX_ASSET_BYTES = 50 * 1024 * 1024
/** Attached files and videos can be larger than images. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024

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

  /**
   * Stores any kept file type (PDF, document, video, audio…); images go
   * through `save`, which checks their content.
   */
  async saveFile(bytes: Uint8Array, fileName: string): Promise<string> {
    const ext = assetExtension(fileName)
    if (!ext) throw new Error(`Type de fichier non pris en charge : ${fileName}`)
    if (ASSET_TYPES[ext].kind === 'image') return this.save(bytes, fileName)
    if (bytes.byteLength > MAX_FILE_BYTES)
      throw new Error(`Fichier trop volumineux (max ${MAX_FILE_BYTES / 1024 / 1024} Mo).`)
    const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`
    await this.write(name, bytes)
    return assetSrc(name)
  }

  private async write(name: string, bytes: Uint8Array): Promise<void> {
    const target = join(this.dir, name)
    if (existsSync(target)) return
    await mkdir(this.dir, { recursive: true })
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, bytes)
    await rename(temp, target)
  }

  /**
   * Stores an image sent under its final name (by a client that computed it):
   * the name must match the bytes' hash and type.
   */
  async put(name: string, bytes: Uint8Array): Promise<void> {
    if (!ASSET_NAME.test(name)) throw new Error('Nom de fichier invalide.')
    const [hash, ext] = name.split('.')
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error('Le contenu ne correspond pas au nom.')
    if (ASSET_TYPES[ext].kind === 'image') {
      if (detectImageType(bytes, name) !== ext) throw new Error("Type d'image incorrect.")
      if ((await this.save(bytes, name)) !== assetSrc(name)) throw new Error('Image refusée.')
    } else await this.write(name, bytes)
  }

  /** Bytes and media type of a stored asset, or null for an invalid or unknown name. */
  async load(name: string): Promise<{ bytes: Uint8Array; type: string } | null> {
    const path = this.pathOf(name)
    if (!path) return null
    return {
      bytes: new Uint8Array(await readFile(path)),
      type: ASSET_TYPES[name.split('.')[1]].mime
    }
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
