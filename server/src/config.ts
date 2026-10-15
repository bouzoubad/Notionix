import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export interface Config {
  /** Port the server listens on (IIS forwards to it) */
  port: number
  /** Interface to listen on: 127.0.0.1 behind a reverse proxy on the same host, 0.0.0.0 in a container */
  host: string
  /** Folder holding the database and the images; back it up */
  dataDir: string
  /** Lifetime of a login session, in days */
  sessionDays: number
  /** Built web client (index.html and its files), served at the root; null: API only */
  webDir: string | null
  /** Optional first administrator, created at start if no account exists */
  adminEmail: string | null
  adminPassword: string | null
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const number = (value: string | undefined, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    // 0 picks a free port (tests).
    port: env.NOTIONIX_PORT === '0' ? 0 : number(env.NOTIONIX_PORT, 8080),
    host: env.NOTIONIX_HOST ?? '127.0.0.1',
    dataDir: env.NOTIONIX_DATA_DIR ?? join(process.cwd(), 'data'),
    sessionDays: number(env.NOTIONIX_SESSION_DAYS, 30),
    webDir: env.NOTIONIX_WEB_DIR || join(dirname(fileURLToPath(import.meta.url)), 'web'),
    adminEmail: env.NOTIONIX_ADMIN_EMAIL || null,
    adminPassword: env.NOTIONIX_ADMIN_PASSWORD || null
  }
}
