import { useState } from 'react'
import { t } from '../../../shared/i18n'
import { isLocalPage, platform, type OfflineSource } from '../platform'
import { offlineStatusText, useOfflineStatus } from '../offline'
import { useStore } from '../store'

/**
 * The sidebar's line about the copies kept for working without network
 * (desktop app linked to a server); it opens their settings.
 */
export function OfflineStatusLine(): React.JSX.Element | null {
  const copies = platform().offline
  const status = useOfflineStatus()
  const connected = useStore((s) => s.connected)
  const [open, setOpen] = useState(false)
  if (!copies || !status) return null
  const Dialog = copies.Dialog
  return (
    <>
      <button
        className={`offline-status${connected ? '' : ' offline'}${status.running ? ' running' : ''}`}
        title={t('Pages gardées sur cet ordinateur pour travailler sans réseau')}
        onClick={() => setOpen(true)}
      >
        {offlineStatusText(status, connected)}
      </button>
      {open && <Dialog connected={connected} onClose={() => setOpen(false)} />}
    </>
  )
}

const SOURCES: Record<OfflineSource, () => string> = {
  page: () => t('Choisi pour cette page et ses sous-pages'),
  parent: () => t('Comme la page parente'),
  workspace: () => t('Comme son espace'),
  always: () => t('Toujours gardée : page privée, favorite ou ouverte récemment')
}

/**
 * Like OneDrive, in a page's menus: keep it on this computer (with its
 * sub-pages), or online only.
 */
export function OfflineChoice({
  pageId,
  onDone
}: {
  pageId: string
  onDone: () => void
}): React.JSX.Element | null {
  const copies = platform().offline
  useOfflineStatus()
  if (!copies || isLocalPage(pageId)) return null
  const a = copies.availability(pageId)
  const choose = (value: 'keep' | 'online'): void => {
    // The same as without a choice of its own: the page follows its parent again.
    copies.setPage(pageId, value === a.inherited ? null : value)
    onDone()
  }
  return (
    <div className="offline-choice" role="group" aria-label={t('Hors ligne')}>
      <span className="offline-choice-title">{t('Hors ligne')}</span>
      <button role="menuitemradio" aria-checked={a.value === 'keep'} onClick={() => choose('keep')}>
        <span className="check">{a.value === 'keep' ? '✓' : ''}</span>
        {t('Garder sur cet ordinateur')}
      </button>
      <button
        role="menuitemradio"
        aria-checked={a.value === 'online'}
        onClick={() => choose('online')}
      >
        <span className="check">{a.value === 'online' ? '✓' : ''}</span>
        {t('En ligne uniquement')}
      </button>
      <small className="offline-choice-source">{SOURCES[a.source]()}</small>
    </div>
  )
}
