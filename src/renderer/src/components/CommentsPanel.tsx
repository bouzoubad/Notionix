import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { atLeast, type Comment, type PageSummary, type Person } from '../../../shared/types'
import { useStore } from '../store'
import { platform } from '../platform'
import { ago } from '../time'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

interface Thread {
  id: string
  quote: string | null
  comments: Comment[]
  resolved: boolean
}

/** Discussions of a page, beside its content. */
export function CommentsPanel({
  page,
  editor
}: {
  page: PageSummary
  editor: Editor | null
}): React.JSX.Element {
  const state = useStore((s) => s.comments)
  const close = useStore((s) => s.closeComments)
  const clearDraft = useStore((s) => s.clearDraft)
  const revision = useStore((s) => s.revision)
  const showNotice = useStore((s) => s.showNotice)
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const canComment = atLeast(page.level, 'comment')

  const reload = useCallback(async () => {
    setComments(await window.api.comments.list(page.id))
  }, [page.id])
  useEffect(() => {
    let cancelled = false
    window.api.comments.list(page.id).then((c) => !cancelled && setComments(c))
    return () => {
      cancelled = true
    }
  }, [page.id, revision])

  const threads = useMemo(() => {
    const byId = new Map<string, Thread>()
    for (const c of comments ?? []) {
      const t = byId.get(c.threadId) ?? {
        id: c.threadId,
        quote: c.quote,
        comments: [],
        resolved: c.resolvedAt !== null
      }
      t.comments.push(c)
      byId.set(c.threadId, t)
    }
    return [...byId.values()]
  }, [comments])

  // Marks left by a discussion that was never posted (page left while writing) are removed.
  const draftId = state.draft?.threadId
  useEffect(() => {
    if (!editor || !editor.isEditable || comments === null) return
    const known = new Set(threads.map((t) => t.id))
    const orphans = new Set<string>()
    editor.state.doc.descendants((node) => {
      for (const m of node.marks)
        if (m.type.name === 'comment' && m.attrs.threadId && !known.has(m.attrs.threadId))
          orphans.add(m.attrs.threadId)
    })
    for (const id of orphans) if (id !== draftId) editor.commands.unsetCommentThread(id)
  }, [editor, comments, threads, draftId])

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      await reload()
      return true
    } catch (e) {
      showNotice(`Commentaire impossible : ${message(e)}`)
      return false
    }
  }
  const unmark = (threadId: string): void => {
    if (editor?.isEditable) editor.commands.unsetCommentThread(threadId)
  }

  const open = threads.filter((t) => !t.resolved)
  const resolved = threads.filter((t) => t.resolved)
  const ordered = state.focus
    ? [...open.filter((t) => t.id === state.focus), ...open.filter((t) => t.id !== state.focus)]
    : open

  return (
    <aside className="comments-panel">
      <header>
        <h3>Commentaires</h3>
        <button title="Fermer" aria-label="Fermer" onClick={close}>
          ✕
        </button>
      </header>
      <div className="comments-scroll">
        {state.draft && (
          <div className="thread focused">
            {state.draft.quote && <blockquote>{state.draft.quote}</blockquote>}
            <Composer
              autoFocus
              placeholder="Ajouter un commentaire…"
              onCancel={() => {
                if (state.draft?.marked) unmark(state.draft.threadId)
                clearDraft()
              }}
              onSubmit={async (body, mentions) => {
                const draft = state.draft!
                // The thread keeps the id of the marked text.
                const ok = await run(() =>
                  window.api.comments.add(page.id, {
                    threadId: draft.threadId,
                    body,
                    mentions,
                    quote: draft.quote || null
                  })
                )
                if (ok) clearDraft()
                return ok
              }}
            />
          </div>
        )}
        {!state.draft && canComment && (
          <div className="thread">
            <Composer
              placeholder="Commenter la page…"
              onSubmit={(body, mentions) =>
                run(() => window.api.comments.add(page.id, { body, mentions }))
              }
            />
          </div>
        )}
        {comments === null && <p className="comments-empty">Chargement…</p>}
        {comments !== null && threads.length === 0 && !state.draft && (
          <p className="comments-empty">
            Aucun commentaire. Sélectionnez du texte puis « Commenter », ou commentez la page.
          </p>
        )}
        {ordered.map((t) => (
          <ThreadView
            key={t.id}
            thread={t}
            focused={t.id === state.focus}
            canComment={canComment}
            canModerate={page.level === 'full'}
            run={run}
            onResolve={(flag) =>
              void run(() => window.api.comments.resolve(t.id, flag)).then(
                (ok) => ok && flag && unmark(t.id)
              )
            }
            onEmptied={() => unmark(t.id)}
          />
        ))}
        {resolved.length > 0 && (
          <button
            className="comments-resolved-toggle"
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? '▾' : '▸'} {resolved.length} discussion(s) résolue(s)
          </button>
        )}
        {showResolved &&
          resolved.map((t) => (
            <ThreadView
              key={t.id}
              thread={t}
              focused={false}
              canComment={canComment}
              canModerate={page.level === 'full'}
              run={run}
              onResolve={(flag) => void run(() => window.api.comments.resolve(t.id, flag))}
              onEmptied={() => undefined}
            />
          ))}
      </div>
    </aside>
  )
}

function ThreadView({
  thread,
  focused,
  canComment,
  canModerate,
  run,
  onResolve,
  onEmptied
}: {
  thread: Thread
  focused: boolean
  canComment: boolean
  canModerate: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onResolve: (resolved: boolean) => void
  onEmptied: () => void
}): React.JSX.Element {
  const people = useStore((s) => s.people)
  const me = platform().session?.user.id ?? 'local'
  const [editing, setEditing] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])
  const name = (id: string | null): string =>
    people.find((p) => p.id === id)?.name ?? (id ? 'Compte supprimé' : 'Inconnu')

  return (
    <div
      ref={ref}
      className={`thread${focused ? ' focused' : ''}${thread.resolved ? ' resolved' : ''}`}
    >
      <div className="thread-head">
        {thread.quote ? (
          <blockquote>{thread.quote}</blockquote>
        ) : (
          <span className="thread-page">Sur la page</span>
        )}
        {canComment && (
          <button
            title={thread.resolved ? 'Rouvrir' : 'Résoudre'}
            onClick={() => onResolve(!thread.resolved)}
          >
            {thread.resolved ? 'Rouvrir' : '✓ Résoudre'}
          </button>
        )}
      </div>
      {thread.comments.map((c) => (
        <div key={c.id} className="comment">
          <div className="comment-meta">
            <strong>{name(c.authorId)}</strong>
            <span>
              {ago(c.createdAt)}
              {c.editedAt ? ' · modifié' : ''}
            </span>
          </div>
          {editing === c.id ? (
            <Composer
              autoFocus
              initial={c.body}
              initialMentions={c.mentions}
              onCancel={() => setEditing(null)}
              onSubmit={async (body, mentions) => {
                const ok = await run(() => window.api.comments.update(c.id, body, mentions))
                if (ok) setEditing(null)
                return ok
              }}
            />
          ) : (
            <p className="comment-body">
              <MentionText body={c.body} mentions={c.mentions} people={people} />
            </p>
          )}
          {editing !== c.id && (c.authorId === me || canModerate) && (
            <div className="comment-actions">
              {c.authorId === me && <button onClick={() => setEditing(c.id)}>Modifier</button>}
              <button
                onClick={() => {
                  if (!confirm('Supprimer ce commentaire ?')) return
                  void run(() => window.api.comments.remove(c.id)).then(
                    (ok) => ok && thread.comments.length === 1 && onEmptied()
                  )
                }}
              >
                Supprimer
              </button>
            </div>
          )}
        </div>
      ))}
      {canComment && !thread.resolved && (
        <Composer
          placeholder="Répondre…"
          onSubmit={(body, mentions) =>
            run(() =>
              window.api.comments.add(thread.comments[0].pageId, {
                threadId: thread.id,
                body,
                mentions
              })
            )
          }
        />
      )}
    </div>
  )
}

/** Comment text with the mentioned people highlighted. */
function MentionText({
  body,
  mentions,
  people
}: {
  body: string
  mentions: string[]
  people: Person[]
}): React.JSX.Element {
  const names = mentions
    .map((id) => people.find((p) => p.id === id)?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => b.length - a.length)
  if (names.length === 0) return <>{body}</>
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g')
  return (
    <>
      {body.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mention mention-user">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  )
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Text box for a comment; "@" suggests people, whose names become mentions. */
function Composer({
  onSubmit,
  onCancel,
  placeholder = '',
  autoFocus = false,
  initial = '',
  initialMentions = []
}: {
  onSubmit: (body: string, mentions: string[]) => Promise<boolean>
  onCancel?: () => void
  placeholder?: string
  autoFocus?: boolean
  initial?: string
  initialMentions?: string[]
}): React.JSX.Element {
  const people = useStore((s) => s.people)
  const [body, setBody] = useState(initial)
  const [mentions, setMentions] = useState<string[]>(initialMentions)
  const [query, setQuery] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const web = platform().session !== null

  const suggestions =
    web && query !== null
      ? people
          .filter((p) => !p.disabled && p.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 6)
      : []

  const onChange = (value: string): void => {
    setBody(value)
    const caret = area.current?.selectionStart ?? value.length
    const match = /(?:^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret))
    setQuery(match ? match[1] : null)
  }
  const pick = (person: Person): void => {
    const caret = area.current?.selectionStart ?? body.length
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${person.name} `)
    setBody(before + body.slice(caret))
    setMentions((m) => (m.includes(person.id) ? m : [...m, person.id]))
    setQuery(null)
    area.current?.focus()
  }
  const submit = async (): Promise<void> => {
    if (!body.trim() || busy) return
    setBusy(true)
    // Only the people still named in the text are mentioned.
    const kept = mentions.filter((id) => {
      const p = people.find((x) => x.id === id)
      return p && body.includes(`@${p.name}`)
    })
    const ok = await onSubmit(body, kept)
    setBusy(false)
    if (ok && !onCancel) {
      setBody('')
      setMentions([])
    }
  }

  return (
    <div className="composer">
      <textarea
        ref={area}
        autoFocus={autoFocus}
        rows={body.includes('\n') ? 3 : 1}
        placeholder={placeholder}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (suggestions.length) pick(suggestions[0])
            else void submit()
          }
          if (e.key === 'Escape') {
            if (query !== null) setQuery(null)
            else onCancel?.()
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="composer-suggestions">
          {suggestions.map((p) => (
            <button key={p.id} onMouseDown={(e) => (e.preventDefault(), pick(p))}>
              👤 {p.name} <span>{p.email}</span>
            </button>
          ))}
        </div>
      )}
      {(body.trim() || onCancel) && (
        <div className="composer-actions">
          {onCancel && <button onClick={onCancel}>Annuler</button>}
          <button className="primary" disabled={!body.trim() || busy} onClick={() => void submit()}>
            Envoyer
          </button>
        </div>
      )}
    </div>
  )
}
