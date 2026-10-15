import { useEffect, useState } from 'react'
import type { ActivityItem, InboxItem } from '../../../shared/types'
import { pendComments, useStore } from '../store'
import { platform } from '../platform'
import { ago } from '../time'
import { iconText } from '../icons'

const ICONS: Record<InboxItem['kind'], string> = {
  mention: '@',
  comment: '💬',
  share: '🔗',
  reminder: '⏰',
  feedback: '💬'
}

const ACTIVITY: Record<ActivityItem['kind'], string> = {
  created: 'a créé',
  edited: 'a modifié',
  commented: 'a commenté',
  shared: 'a partagé',
  restored: 'a restauré une version de',
  trashed: 'a mis à la corbeille'
}

/** Notifications for this person, and recent changes in the workspace. */
export function InboxDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const pages = useStore((s) => s.pages)
  const people = useStore((s) => s.people)
  const open = useStore((s) => s.open)
  const openComments = useStore((s) => s.openComments)
  const refreshInbox = useStore((s) => s.refreshInbox)
  const [tab, setTab] = useState<'inbox' | 'activity'>('inbox')
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const team = platform().session !== null

  useEffect(() => {
    const load = (): void => void window.api.inbox.list().then(setItems)
    load()
    return window.api.inbox.onChange(load)
  }, [])
  useEffect(() => {
    if (tab === 'activity') void window.api.inbox.activity().then(setActivity)
  }, [tab])

  const pageLabel = (id: string | null): string => {
    const p = pages.find((x) => x.id === id)
    return p ? `${iconText(p.icon)} ${p.title || 'Sans titre'}` : 'Page supprimée'
  }
  const go = async (item: InboxItem): Promise<void> => {
    if (!item.readAt) await window.api.inbox.markRead([item.id])
    void refreshInbox()
    if (item.kind === 'feedback') {
      useStore.getState().openFeedback(item.ref)
      onClose()
      return
    }
    if (item.workspace && item.pageId) {
      // In another workspace: it opens on the page (and the discussion).
      if (item.ref) pendComments(item.pageId, item.ref)
      platform().session?.workspaces.switchTo(item.workspace.id, item.pageId)
      return
    }
    if (item.pageId) {
      open(item.pageId)
      if (item.ref) openComments(item.ref)
    }
    onClose()
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog inbox" onMouseDown={(e) => e.stopPropagation()}>
        <div className="inbox-head">
          <div className="settings-tabs">
            <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
              Boîte de réception
            </button>
            <button
              className={tab === 'activity' ? 'active' : ''}
              onClick={() => setTab('activity')}
            >
              Activité
            </button>
          </div>
          {tab === 'inbox' && items?.some((i) => !i.readAt) && (
            <button
              className="inbox-read-all"
              onClick={async () => {
                await window.api.inbox.markRead(null)
                setItems(await window.api.inbox.list())
                void refreshInbox()
              }}
            >
              Tout marquer comme lu
            </button>
          )}
        </div>
        <div className="results">
          {tab === 'inbox' &&
            (items === null ? (
              <p className="inbox-empty">Chargement…</p>
            ) : items.length === 0 ? (
              <p className="inbox-empty">
                {team
                  ? 'Rien de nouveau. Les mentions, commentaires, partages et rappels arrivent ici.'
                  : 'Rien de nouveau. Vos rappels arrivent ici.'}
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  className={`inbox-item${item.readAt ? '' : ' unread'}`}
                  onClick={() => void go(item)}
                >
                  <span className="inbox-icon">{ICONS[item.kind]}</span>
                  <span className="inbox-text">
                    <span>{item.text}</span>
                    <small>
                      {item.workspace
                        ? `${item.workspace.name} › ${item.workspace.pageTitle ?? ''}${item.workspace.pageTitle !== null ? ' · ' : ''}`
                        : item.pageId
                          ? `${pageLabel(item.pageId)} · `
                          : ''}
                      {ago(item.createdAt)}
                    </small>
                  </span>
                </button>
              ))
            ))}
          {tab === 'activity' &&
            (activity === null ? (
              <p className="inbox-empty">Chargement…</p>
            ) : activity.length === 0 ? (
              <p className="inbox-empty">Aucune activité récente.</p>
            ) : (
              activity.map((a) => (
                <button
                  key={a.id}
                  className="inbox-item"
                  onClick={() => (open(a.pageId), onClose())}
                >
                  <span className="inbox-icon">•</span>
                  <span className="inbox-text">
                    <span>
                      <strong>{people.find((p) => p.id === a.actorId)?.name ?? 'Quelqu’un'}</strong>{' '}
                      {ACTIVITY[a.kind]} {pageLabel(a.pageId)}
                      {a.detail ? ` : « ${a.detail} »` : ''}
                    </span>
                    <small>{ago(a.at)}</small>
                  </span>
                </button>
              ))
            ))}
        </div>
      </div>
    </div>
  )
}
