import { useEffect, useState } from 'react'
import { olderVersion } from '../shared/changelog'
import { macDownloadUrls, type DownloadsInfo } from '../shared/desktop'
import { t } from '../shared/i18n'
import { serverOrigin } from '../renderer/src/platform'
import { json } from '../web/http'

const DISMISSED_KEY = 'notionix-update-dismissed'

/**
 * A newer version of the desktop app on the linked server: where to
 * download it (until closed, for that version).
 */
export function UpdateNotice(): React.JSX.Element | null {
  const [offer, setOffer] = useState<{ version: string; url: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [mine, info] = await Promise.all([
        window.desktop!.appVersion(),
        json<DownloadsInfo>('/api/downloads')
      ])
      const latest = info.mac?.version
      const urls = macDownloadUrls(serverOrigin(), info)
      let dismissed: string | null = null
      try {
        dismissed = localStorage.getItem(DISMISSED_KEY)
      } catch {
        dismissed = null
      }
      if (cancelled || !latest || !urls || dismissed === latest) return
      if (olderVersion(mine, latest)) setOffer({ version: latest, url: urls.shared })
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  if (!offer) return null
  const close = (): void => {
    try {
      localStorage.setItem(DISMISSED_KEY, offer.version)
    } catch {
      // Shown again next time.
    }
    setOffer(null)
  }
  return (
    <div className="app-notice update-notice" role="status">
      <span>
        {t('Nouvelle version de l’app de bureau : {version}.', { version: offer.version })}
      </span>
      <span className="app-notice-actions">
        <a className="button primary" href={offer.url} target="_blank" rel="noreferrer">
          {t('Télécharger')}
        </a>
        <button aria-label={t('Fermer')} onClick={close}>
          ×
        </button>
      </span>
    </div>
  )
}
