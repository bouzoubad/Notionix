import { useEffect, useState } from 'react'
import {
  FEEDBACK_STATUS_LABELS,
  type Feedback,
  type FeedbackKind,
  type FeedbackStatus,
  type SessionUser
} from '../shared/collab'
import { assetNameFromSrc, assetWebPath } from '../shared/assets'
import { json } from './http'
import { webApi } from './api'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const when = (ms: number): string =>
  new Date(ms).toLocaleString('fr-FR', {
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
        <h3>Feedback</h3>
        <div className="settings-tabs">
          <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}>
            Signaler un bug ou proposer une idée
          </button>
          <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            {admin ? 'Tous les retours' : 'Mes retours'}
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
          <input type="radio" checked={kind === 'bug'} onChange={() => setKind('bug')} /> 🐞 Un bug
        </label>
        <label className={kind === 'idea' ? 'active' : ''}>
          <input type="radio" checked={kind === 'idea'} onChange={() => setKind('idea')} /> 💡 Une
          idée d’amélioration
        </label>
      </div>
      <label>
        Titre
        <input
          required
          maxLength={200}
          placeholder={
            kind === 'bug' ? 'Ex. : la recherche ne trouve pas…' : 'Ex. : pouvoir trier par…'
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        {kind === 'bug'
          ? 'Ce qui s’est passé, et ce que vous attendiez'
          : 'Votre idée, et à quoi elle servirait'}
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label>
        Capture d’écran (facultatif)
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
        />
      </label>
      <p className="settings-note">
        La page ouverte et le navigateur utilisé sont joints automatiquement.
      </p>
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !title.trim()}>
        {busy ? 'Envoi…' : 'Envoyer'}
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
  if (items === null) return <p className="settings-note">Chargement…</p>
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
          <option value="all">Bugs et idées</option>
          <option value="bug">Bugs</option>
          <option value="idea">Idées</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as FeedbackStatus | 'open' | 'all')}
        >
          <option value="open">À traiter</option>
          <option value="all">Tous les statuts</option>
          {Object.entries(FEEDBACK_STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 && <p className="settings-note">Aucun retour ici.</p>}
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
  const patch = async (next: Record<string, unknown>): Promise<void> => {
    try {
      await json(`/api/feedback/${encodeURIComponent(item.id)}`, { method: 'PATCH', json: next })
      await onChanged()
    } catch (e) {
      setError(message(e))
    }
  }
  const shot = item.screenshot ? assetNameFromSrc(item.screenshot) : null
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
      {shot && (
        <a href={assetWebPath(shot)} target="_blank" rel="noreferrer">
          <img className="feedback-shot" src={assetWebPath(shot)} alt="Capture jointe" />
        </a>
      )}
      {admin && Object.keys(item.context).length > 0 && (
        <details className="feedback-context">
          <summary>Contexte</summary>
          {Object.entries(item.context).map(([k, v]) => (
            <div key={k}>
              <strong>{k}</strong> : {v}
            </div>
          ))}
        </details>
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
            placeholder="Réponse à l’auteur (il est prévenu)"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <button disabled={reply === (item.reply ?? '')} onClick={() => void patch({ reply })}>
            Répondre
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm('Supprimer ce retour ?')) return
              await json(`/api/feedback/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
              await onChanged()
            }}
          >
            Supprimer
          </button>
        </div>
      ) : (
        item.reply && (
          <p className="feedback-reply">
            <strong>Réponse :</strong> {item.reply}
          </p>
        )
      )}
      {error && <p className="error">{error}</p>}
    </article>
  )
}
