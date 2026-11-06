import type { IpcMain } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { ASSET_NAME, assetNamesIn } from '../shared/assets'
import type { AssetStore } from '../core/assets'
import type { ServerCache } from '../core/serverCache'

/** At most this many names or pages in one call from the page. */
const MAX_ITEMS = 5000
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Which downloaded files may be deleted: those fetched from the server that
 * neither a kept answer nor a page of this computer refers to. A file that
 * was not fetched from the server (written here, or imported) is never one.
 */
export function filesToFree(fetched: Iterable<string>, inUse: ReadonlySet<string>): string[] {
  return [...fetched].filter((name) => !inUse.has(name))
}

/**
 * The files the pages of this computer use (pages written without network,
 * pages of the app on its own, their comments): never deleted to free space.
 */
export function localAssets(db: DatabaseSync): Set<string> {
  const names = new Set<string>()
  const scan = (sql: string): void => {
    try {
      for (const row of db.prepare(sql).iterate() as Iterable<Record<string, string | null>>)
        for (const value of Object.values(row)) if (value) assetNamesIn(value, names)
    } catch {
      // A table of an older database: nothing there.
    }
  }
  scan('SELECT content, icon, cover, properties, db_schema FROM pages')
  scan('SELECT body FROM comments')
  return names
}

/**
 * The server's files kept on this computer for working without network: each
 * one downloaded once into the app's files (named by their content), noted as
 * fetched, and deleted again when no kept page needs it any more.
 */
export class OfflineFiles {
  constructor(
    private readonly cache: ServerCache,
    private readonly assets: AssetStore,
    /** Downloads one file of the linked server; null when unavailable */
    private readonly download: (name: string) => Promise<Uint8Array | null>,
    /** The files the pages of this computer use (never deleted) */
    private readonly localUses: () => Set<string>,
    /** The linked server's address */
    private readonly server: () => string | null
  ) {}

  /** A file of the server, downloaded unless already here: its path, or null. */
  async locate(name: string): Promise<string | null> {
    const path = this.assets.pathOf(name)
    if (path) return path
    const bytes = await this.download(name)
    if (!bytes) return null
    try {
      await this.assets.put(name, bytes)
    } catch {
      return null
    }
    this.cache.markFetched(name)
    return this.assets.pathOf(name)
  }

  /**
   * Makes sure these files are on this computer (downloading the missing ones,
   * one after the other). Returns the size of each one that is here.
   */
  async keep(names: string[]): Promise<Record<string, number>> {
    const sizes: Record<string, number> = {}
    for (const name of names) {
      if (!ASSET_NAME.test(name)) continue
      if (!(await this.locate(name))) continue
      const size = this.assets.sizeOf(name)
      if (size !== null) sizes[name] = size
    }
    return sizes
  }

  /**
   * Forgets what was kept of these pages, then frees the files nothing kept
   * needs any more. Returns the bytes freed.
   */
  forgetPages(pageIds: string[]): number {
    const server = this.server()
    if (server) this.cache.forgetPages(server, pageIds)
    return this.free()
  }

  /** Deletes the downloaded files no kept answer and no page of this computer refers to. */
  free(): number {
    const inUse = this.cache.referencedAssets()
    for (const name of this.localUses()) inUse.add(name)
    const freed = filesToFree(this.cache.fetchedAssets(), inUse)
    let bytes = 0
    for (const name of freed) bytes += this.assets.remove(name)
    this.cache.unmarkFetched(freed)
    return bytes
  }
}

const strings = (value: unknown, valid: RegExp): string[] => {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error('Arguments invalides.')
  return value.filter((v): v is string => typeof v === 'string' && valid.test(v))
}

/** The page's calls about the copies kept for working without network. */
export function registerOfflineHandlers(ipc: IpcMain, files: OfflineFiles): void {
  ipc.handle('server:keepFiles', (_e, names: unknown) => files.keep(strings(names, ASSET_NAME)))
  ipc.handle('server:forgetPages', (_e, ids: unknown) => files.forgetPages(strings(ids, PAGE_ID)))
}
