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
}

/** The desktop app version of a client, or null. */
export const desktopVersion = (client: string): string | null =>
  client.startsWith('desktop:') ? client.slice('desktop:'.length) || null : null
