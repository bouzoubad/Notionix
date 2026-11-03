import { useEffect, useState } from 'react'
import {
  FEEDBACK_STATUS_LABELS,
  type Feedback,
  type FeedbackKind,
  type FeedbackStatus,
  type SessionUser
} from '../shared/collab'
import { assetNameFromSrc, assetWebPath } from '../shared/assets'
import { displaySrc, platform } from '../renderer/src/platform'
import { json } from './http'
import { webApi } from './api'
import { locale, t } from '../shared/i18n'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const when = (ms: number): string =>
  new Date(ms).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

/**
 * Bugs and ideas: everyone sends theirs and follows their status;
 * administrators see them all, answer and set their status.
 */
export function FeedbackDialog({
  user,
  focus,
  onClose
}: {
  user: SessionUser
  focus: string | null
  onClose: () => void
}): React.JSX.Element {
  const admin = user.role === 'admin'
  const [tab, setTab] = useState<'send' | 'list'>(focus ? 'list' : 'send')
  const [items, setItems] = useState<Feedback[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = async (): Promise<void> => {
    try {
      setItems((await json<{ feedback: Feedback[] }>('/api/feedback')).feedback)
    } catch (e) {
      setError(message(e))
    }
  }
  useEffect(() => {
    let cancelled = false
    json<{ feedback: Feedback[] }>('/api/feedback')
      .then(({ feedback }) => !cancelled && setItems(feedback))
      .catch((e) => !cancelled && setError(message(e)))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog settings feedback" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('Feedback')}</h3>
        <div className="settings-tabs">
          <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}>
            {t('Signaler un bug ou proposer une idée')}
          </button>
          <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            {admin ? t('Tous les retours') : t('Mes retours')}
            {items ? ` (${items.length})` : ''}
          </button>
        </div>
        <div className="settings-body">
          {error && <p className="error">{error}</p>}
          {tab === 'send' ? (
            <SendForm
              onSent={async () => {
                await reload()
                setTab('list')
              }}
            />
          ) : (
            <FeedbackList items={items} admin={admin} focus={focus} onChanged={reload} />
          )}
        </div>
      </div>
    </div>
  )
}

function SendForm({ onSent }: { onSent: () => Promise<void> }): React.JSX.Element {
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const src = screenshot
        ? await webApi.assets.save(new Uint8Array(await screenshot.arrayBuffer()), screenshot.name)
        : null
      // Where it happened helps reproduce a bug.
      const context: Record<string, string> = {
        adresse: location.href,
        navigateur: navigator.userAgent,
        écran: `${window.innerWidth}×${window.innerHeight}`
      }
      const pageId = localStorage.getItem('currentId')
      if (pageId) context.page = pageId
      await json('/api/feedback', { json: { kind, title, body, screenshot: src, context } })
      setTitle('')
      setBody('')
      setScreenshot(null)
      await onSent()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="settings-form feedback-form" onSubmit={(e) => void submit(e)}>
      <div className="feedback-kinds">
        <label className={kind === 'bug' ? 'active' : ''}>
          <input type="radio" checked={kind === 'bug'} onChange={() => setKind('bug')} /> 🐞{' '}
          {t('Un bug')}
        </label>
        <label className={kind === 'idea' ? 'active' : ''}>
          <input type="radio" checked={kind === 'idea'} onChange={() => setKind('idea')} /> 💡{' '}
          {t('Une idée d’amélioration')}
        </label>
      </div>
      <label>
        {t('Titre')}
        <input
          required
          maxLength={200}
          placeholder={
            kind === 'bug' ? t('Ex. : la recherche ne trouve pas…') : t('Ex. : pouvoir trier par…')
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        {kind === 'bug'
          ? t('Ce qui s’est passé, et ce que vous attendiez')
          : t('Votre idée, et à quoi elle servirait')}
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label>
        {t('Capture d’écran (facultatif)')}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
        />
      </label>
      <p className="settings-note">
        {t('La page ouverte et le navigateur utilisé sont joints automatiquement.')}
      </p>
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !title.trim()}>
        {busy ? t('Envoi…') : t('Envoyer')}
      </button>
    </form>
  )
}

function FeedbackList({
  items,
  admin,
  focus,
  onChanged
}: {
  items: Feedback[] | null
  admin: boolean
  focus: string | null
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [kind, setKind] = useState<FeedbackKind | 'all'>('all')
  const [status, setStatus] = useState<FeedbackStatus | 'open' | 'all'>(admin ? 'open' : 'all')
  if (items === null) return <p className="settings-note">{t('Chargement…')}</p>
  const open = (s: FeedbackStatus): boolean => s !== 'done' && s !== 'declined'
  const shown = items.filter(
    (i) =>
      i.id === focus ||
      ((kind === 'all' || i.kind === kind) &&
        (status === 'all' || (status === 'open' ? open(i.status) : i.status === status)))
  )
  return (
    <div>
      <div className="feedback-filters">
        <select value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind | 'all')}>
          <option value="all">{t('Bugs et idées')}</option>
          <option value="bug">{t('Bugs')}</option>
          <option value="idea">{t('Idées')}</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as FeedbackStatus | 'open' | 'all')}
        >
          <option value="open">{t('À traiter')}</option>
          <option value="all">{t('Tous les statuts')}</option>
          {Object.entries(FEEDBACK_STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 && <p className="settings-note">{t('Aucun retour ici.')}</p>}
      {shown.map((item) => (
        <FeedbackItem
          key={item.id}
          item={item}
          admin={admin}
          focused={item.id === focus}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function FeedbackItem({
  item,
  admin,
  focused,
  onChanged
}: {
  item: Feedback
  admin: boolean
  focused: boolean
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [reply, setReply] = useState(item.reply ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Said once the reply is saved: the author is told (inbox), the admin sees it here.
  const [sent, setSent] = useState(false)
  const patch = async (next: Record<string, unknown>): Promise<boolean> => {
    setError(null)
    try {
      await json(`/api/feedback/${encodeURIComponent(item.id)}`, { method: 'PATCH', json: next })
      await onChanged()
      return true
    } catch (e) {
      setError(message(e))
      return false
    }
  }
  const sendReply = async (): Promise<void> => {
    setSending(true)
    setSent(false)
    const ok = await patch({ reply: reply.trim() })
    setSending(false)
    if (ok) setSent(true)
  }
  const shot = item.screenshot ? assetNameFromSrc(item.screenshot) : null
  const [wholeShot, setWholeShot] = useState(false)
  return (
    <article className={`feedback-item status-${item.status}${focused ? ' focused' : ''}`}>
      <header>
        <span>{item.kind === 'bug' ? '🐞' : '💡'}</span>
        <strong>{item.title}</strong>
        <span className={`feedback-status status-${item.status}`}>
          {FEEDBACK_STATUS_LABELS[item.status]}
        </span>
      </header>
      <p className="settings-note">
        {admin ? `${item.userName} · ` : ''}
        {when(item.createdAt)}
      </p>
      {item.body && <p className="feedback-body">{item.body}</p>}
      {shot && item.screenshot && platform().kind === 'web' && (
        <a href={assetWebPath(shot)} target="_blank" rel="noreferrer">
          <img className="feedback-shot" src={assetWebPath(shot)} alt={t('Capture jointe')} />
        </a>
      )}
      {shot && item.screenshot && platform().kind !== 'web' && (
        // Desktop app: the image comes through the app (fetched from the server); a click shows it whole.
        <button
          type="button"
          className="feedback-shot-button"
          aria-expanded={wholeShot}
          onClick={() => setWholeShot((w) => !w)}
        >
          <img
            className={`feedback-shot${wholeShot ? ' whole' : ''}`}
            src={displaySrc(item.screenshot)}
            alt={t('Capture jointe')}
          />
        </button>
      )}
      {admin && Object.keys(item.context).length > 0 && (
        <details className="feedback-context">
          <summary>{t('Contexte')}</summary>
          {Object.entries(item.context).map(([k, v]) => (
            <div key={k}>
              <strong>{k}</strong> : {v}
            </div>
          ))}
        </details>
      )}
      {admin && item.reply && (
        <p className="feedback-reply">
          <strong>{t('Votre réponse :')}</strong> {item.reply}
        </p>
      )}
      {admin ? (
        <div className="feedback-admin">
          <select value={item.status} onChange={(e) => void patch({ status: e.target.value })}>
            {Object.entries(FEEDBACK_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            placeholder={t('Réponse à l’auteur (il est prévenu)')}
            value={reply}
            onChange={(e) => {
              setReply(e.target.value)
              setSent(false)
            }}
          />
          <button
            className="primary"
            disabled={sending || !reply.trim() || reply.trim() === (item.reply ?? '')}
            onClick={() => void sendReply()}
          >
            {sending ? t('Envoi…') : item.reply ? t('Modifier la réponse') : t('Répondre')}
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(t('Supprimer ce retour ?'))) return
              await json(`/api/feedback/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
              await onChanged()
            }}
          >
            {t('Supprimer')}
          </button>
        </div>
      ) : (
        item.reply && (
          <p className="feedback-reply">
            <strong>{t('Réponse :')}</strong> {item.reply}
          </p>
        )
      )}
      {admin && sent && (
        <p className="feedback-sent" role="status">
          {t('Réponse envoyée : {name} est prévenu·e dans sa boîte de réception.', {
            name: item.userName
          })}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  )
}
