import { useEffect, useRef, useState } from 'react'
import { olderVersion } from '../shared/changelog'
import { macDownloadUrls, type DownloadsInfo, type UpdateState } from '../shared/desktop'
import { t } from '../shared/i18n'
import { serverOrigin } from '../renderer/src/platform'
import { json } from '../web/http'

const DISMISSED_KEY = 'notionix-update-dismissed'

const dismissedVersion = (): string | null => {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

/**
 * A newer version of the desktop app on the linked server. It downloads by
 * itself, then the person restarts to install it; when the app cannot update
 * itself (or the update failed), the link to download it instead.
 */
export function UpdateNotice(): React.JSX.Element | null {
  const updates = window.desktop!.updates
  const [state, setState] = useState<UpdateState | null>(null)
  const [manual, setManual] = useState<{ version: string; url: string } | null>(null)
  const [closed, setClosed] = useState<string | null>(dismissedVersion)

  useEffect(() => {
    let cancelled = false
    const stop = updates.onChange((s) => !cancelled && setState(s))
    void updates.check().then((s) => !cancelled && setState(s))
    return () => {
      cancelled = true
      stop()
    }
  }, [updates])

  // The administrators see where each app's update is (Comptes de l'équipe).
  const reported = useRef('')
  useEffect(() => {
    if (!state) return
    const step =
      state.status === 'downloading'
        ? `downloading:${state.version}:${Math.floor(state.percent / 25)}`
        : state.status === 'ready'
          ? `ready:${state.version}`
          : state.status
    if (step === reported.current) return
    reported.current = step
    void json('/api/me/app', { method: 'PUT', json: { update: state } }).catch(() => undefined)
  }, [state])

  // No update by itself: offer the download.
  const fallback = state?.status === 'unsupported' || state?.status === 'error'
  useEffect(() => {
    if (!fallback) return
    let cancelled = false
    void (async () => {
      const [mine, info] = await Promise.all([
        window.desktop!.appVersion(),
        json<DownloadsInfo>('/api/downloads')
      ])
      const latest = info.mac?.version
      const urls = macDownloadUrls(serverOrigin(), info)
      if (!cancelled && latest && urls && olderVersion(mine, latest))
        setManual({ version: latest, url: urls.shared })
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [fallback])

  const close = (version: string): void => {
    try {
      localStorage.setItem(DISMISSED_KEY, version)
    } catch {
      // Shown again next time.
    }
    setClosed(version)
  }
  const closeButton = (version: string): React.JSX.Element => (
    <button aria-label={t('Fermer')} onClick={() => close(version)}>
      ×
    </button>
  )

  if (state?.status === 'ready' && closed !== state.version)
    return (
      <div className="app-notice update-notice" role="status">
        <span>
          {t('Nouvelle version de l’app ({version}) prête : redémarrez pour l’installer.', {
            version: state.version
          })}
        </span>
        <span className="app-notice-actions">
          <button className="primary" onClick={() => void updates.install()}>
            {t('Redémarrer')}
          </button>
          {closeButton(state.version)}
        </span>
      </div>
    )
  if (state?.status === 'downloading' && closed !== state.version)
    return (
      <div className="app-notice update-notice" role="status">
        <span>
          {t('Téléchargement de la version {version} de l’app… {percent} %', {
            version: state.version,
            percent: state.percent
          })}
        </span>
      </div>
    )
  if (fallback && manual && closed !== manual.version)
    return (
      <div className="app-notice update-notice" role="status">
        <span>
          {t('Nouvelle version de l’app de bureau : {version}.', { version: manual.version })}
        </span>
        <span className="app-notice-actions">
          <a className="button primary" href={manual.url} target="_blank" rel="noreferrer">
            {t('Télécharger')}
          </a>
          {closeButton(manual.version)}
        </span>
      </div>
    )
  return null
}
