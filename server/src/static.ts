import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { extname, join, normalize, sep } from 'path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

/**
 * The web client's own files. Everything comes from this server, so the page
 * can forbid any other origin; images of pages are served by the API.
 */
const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ')

/** Serves the built web client from `dir`; unknown paths get the app's index page. */
export function createStatic(dir: string | null) {
  const root = dir && existsSync(join(dir, 'index.html')) ? normalize(dir) : null
  return async function serve(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) return false
    const url = new URL(req.url ?? '/', 'http://localhost')
    let path: string
    try {
      path = normalize(join(root, decodeURIComponent(url.pathname)))
    } catch {
      return false
    }
    if (path !== root && !path.startsWith(root + sep)) return false
    const isFile = existsSync(path) && statSync(path).isFile()
    const file = isFile ? path : join(root, 'index.html')
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      // Built files carry a hash in their name; the index page must always be fresh.
      'Cache-Control': file.includes(`${sep}assets${sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_POLICY } : {})
    })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }
}
