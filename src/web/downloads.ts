import { useEffect, useState } from 'react'
import { serverOrigin } from '../renderer/src/platform'
import { macDownloadUrls, type DownloadsInfo } from '../shared/desktop'
import { json } from './http'

/** Where a new person downloads the Mac app, when the server offers it. */
export function useMacDownload(): { direct: string; shared: string } | null {
  const [urls, setUrls] = useState<{ direct: string; shared: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    json<DownloadsInfo>('/api/downloads')
      .then((info) => !cancelled && setUrls(macDownloadUrls(serverOrigin(), info)))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return urls
}
