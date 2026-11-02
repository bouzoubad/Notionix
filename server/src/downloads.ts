import type { IncomingMessage, ServerResponse } from 'http'
import { createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { DesktopDownload, DownloadsInfo } from '../../src/shared/desktop'

/** Names the app's builds have (electron-builder artifactName); nothing else is served. */
const FILE = /^notionix-[0-9A-Za-z.-]+\.dmg$/
const MAC_PATH = '/download/mac'
/** What the desktop app updates itself from: the feed, and the zips it names. */
const UPDATE_FILE = /^(latest-mac\.yml|notionix-[0-9A-Za-z.-]+-mac\.zip)$/
const TYPES: Record<string, string> = {
  dmg: 'application/x-apple-diskimage',
  zip: 'application/zip',
  yml: 'text/yaml; charset=utf-8'
}

const latestMac = (dir: string): { file: string; info: DesktopDownload } | null => {
  if (!existsSync(dir)) return null
  let best: { file: string; info: DesktopDownload; at: number } | null = null
  for (const name of readdirSync(dir)) {
    if (!FILE.test(name)) continue
    const file = join(dir, name)
    const stat = statSync(file, { throwIfNoEntry: false })
    if (!stat?.isFile()) continue
    if (best && stat.mtimeMs <= best.at) continue
    const version = /^notionix-(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? null
    best = { file, info: { name, version, size: stat.size }, at: stat.mtimeMs }
  }
  return best && { file: best.file, info: best.info }
}

/**
 * The desktop app's downloads: files dropped in `dir` (by
 * scripts/publish-desktop.sh), served without a session so that a new person
 * can install the app before signing in. `GET /download/mac` is always the
 * latest; `GET /api/downloads` tells what there is.
 */
export function createDownloads(dir: string, plainPort: number | null) {
  return async function serve(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    if (path === '/api/downloads') {
      const body: DownloadsInfo = { mac: latestMac(dir)?.info ?? null, plainPort }
      const text = JSON.stringify(body)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      })
      res.end(req.method === 'HEAD' ? undefined : text)
      return true
    }
    let found: { file: string; name: string; size: number } | null = null
    if (path === MAC_PATH) {
      const mac = latestMac(dir)
      found = mac && { file: mac.file, name: mac.info.name, size: mac.info.size }
    } else if (path.startsWith('/download/')) {
      const name = path.slice('/download/'.length)
      const file = join(dir, name)
      const stat = UPDATE_FILE.test(name) ? statSync(file, { throwIfNoEntry: false }) : undefined
      if (stat?.isFile()) found = { file, name, size: stat.size }
      else if (!UPDATE_FILE.test(name)) return false
    } else return false
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Aucune version de l’app de bureau n’est disponible sur ce serveur.')
      return true
    }
    const ext = found.name.split('.').pop() ?? ''
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': found.size,
      ...(ext === 'yml' ? {} : { 'Content-Disposition': `attachment; filename="${found.name}"` }),
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    await new Promise<void>((resolve) => {
      const stream = createReadStream(found.file)
      stream.on('error', () => {
        res.destroy()
        resolve()
      })
      res.on('close', () => {
        stream.destroy()
        resolve()
      })
      stream.pipe(res)
    })
    return true
  }
}
