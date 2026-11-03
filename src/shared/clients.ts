/**
 * What a session is used from, read from the request's User-Agent: the
 * desktop app and its version ("desktop:1.1.5", Electron adds
 * "notionix/<version>"), a browser ("web:Safari"), or anything else.
 */
export function clientOf(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const app = /notionix\/(\d+\.\d+\.\d+)/i.exec(ua)
  if (app && /Electron\//.test(ua)) return `desktop:${app[1]}`
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null
  if (browser) return `web:${browser}`
  return `other:${(ua.split(/[\s/]/)[0] || '').slice(0, 30)}`
}

/** Where a session was last used from, as the administration shows it. */
export interface ClientSeen {
  /** clientOf() */
  client: string
  seenAt: number
  /** Desktop app (1.2.1 on): where its own update is, as it last said */
  update?: AppUpdateReport | null
}

/** What a desktop app says of its update (Comptes de l'équipe shows it). */
export interface AppUpdateReport {
  status: 'idle' | 'downloading' | 'ready' | 'error' | 'unsupported'
  /** The version being downloaded or ready */
  version?: string
  percent?: number
  message?: string
  at: number
}

/** A report from an app, made safe (short strings, known statuses). */
export function parseUpdateReport(raw: unknown, at: number): AppUpdateReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const statuses = ['idle', 'downloading', 'ready', 'error', 'unsupported'] as const
  const status = statuses.find((s) => s === r.status)
  if (!status) return null
  const version =
    typeof r.version === 'string' && /^\d+\.\d+\.\d+$/.test(r.version) ? r.version : undefined
  return {
    status,
    ...(version ? { version } : {}),
    ...(typeof r.percent === 'number'
      ? { percent: Math.max(0, Math.min(100, Math.round(r.percent))) }
      : {}),
    ...(typeof r.message === 'string' ? { message: r.message.slice(0, 300) } : {}),
    at
  }
}

/** The desktop app version of a client, or null. */
export const desktopVersion = (client: string): string | null =>
  client.startsWith('desktop:') ? client.slice('desktop:'.length) || null : null
