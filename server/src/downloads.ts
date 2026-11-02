import type { IncomingMessage, ServerResponse } from 'http'
import { createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { DesktopDownload, DownloadsInfo } from '../../src/shared/desktop'

/** Names the app's builds have (electron-builder artifactName); nothing else is served. */
const FILE = /^notionix-[0-9A-Za-z.-]+\.dmg$/
const MAC_PATH = '/download/mac'

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
    if (path !== MAC_PATH) return false
    const found = latestMac(dir)
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Aucune version de l’app de bureau n’est disponible sur ce serveur.')
      return true
    }
    res.writeHead(200, {
      'Content-Type': 'application/x-apple-diskimage',
      'Content-Length': found.info.size,
      'Content-Disposition': `attachment; filename="${found.info.name}"`,
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
