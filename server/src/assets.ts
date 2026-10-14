import { createHash } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { ASSET_NAME, detectImageType } from '../../src/shared/assets'

export const MAX_ASSET_BYTES = 50 * 1024 * 1024

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp'
}

/**
 * Images shared by the workspace, named "<sha256>.<ext>" like in the app. The
 * name is checked against the bytes, so a file can only be stored under its
 * own hash and type.
 */
export class ServerAssets {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'assets')
    mkdirSync(this.dir, { recursive: true })
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    if (!ASSET_NAME.test(name)) throw new Error('Nom de fichier invalide.')
    const [hash, ext] = name.split('.')
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Le contenu ne correspond pas au nom.')
    if (detectImageType(bytes, name) !== ext) throw new Error("Type d'image incorrect.")
    const target = join(this.dir, name)
    if (existsSync(target)) return
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, bytes)
    await rename(temp, target)
  }

  async get(name: string): Promise<{ bytes: Buffer; type: string } | null> {
    if (!ASSET_NAME.test(name)) return null
    const path = join(this.dir, name)
    if (!existsSync(path)) return null
    return { bytes: await readFile(path), type: TYPES[name.split('.')[1]] }
  }

  has(name: string): boolean {
    return ASSET_NAME.test(name) && existsSync(join(this.dir, name))
  }
}
