import { useEffect, useState } from 'react'
import type { SessionUser, WorkspaceInfo } from '../shared/collab'
import type { PersonGroup } from '../shared/types'
import { json } from './http'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

interface Account extends SessionUser {
  disabled: boolean
}

/** Accounts, groups or workspaces, loaded together for the administration tabs. */
function useTeam<T>(
  path: string,
  key: string
): {
  items: T[] | null
  accounts: Account[]
  error: string | null
  setError: (e: string | null) => void
  reload: () => Promise<void>
} {
  const [items, setItems] = useState<T[] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState<string | null>(null)
  const fetchAll = async (): Promise<[T[], Account[]]> => {
    const [list, { users }] = await Promise.all([
      json<Record<string, T[]>>(path),
      json<{ users: Account[] }>('/api/users')
    ])
    return [list[key], users]
  }
  const reload = async (): Promise<void> => {
    const [list, users] = await fetchAll()
    setItems(list)
    setAccounts(users)
  }
  useEffect(() => {
    let cancelled = false
    fetchAll()
      .then(([list, users]) => {
        if (cancelled) return
        setItems(list)
        setAccounts(users)
      })
      .catch((e) => !cancelled && setError(message(e)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key])
  return { items, accounts, error, setError, reload }
}

/** Chooses people among the active accounts. */
function MemberPicker({
  accounts,
  value,
  onChange
}: {
  accounts: Account[]
  value: string[]
  onChange: (ids: string[]) => void
}): React.JSX.Element {
  return (
    <div className="member-picker">
      {accounts
        .filter((a) => !a.disabled || value.includes(a.id))
        .map((a) => (
          <label key={a.id} className={value.includes(a.id) ? 'active' : ''}>
            <input
              type="checkbox"
              checked={value.includes(a.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, a.id] : value.filter((id) => id !== a.id))
              }
            />
            {a.name}
          </label>
        ))}
    </div>
  )
}

/** Groups of people: sharing a page with a group shares it with each member. */
export function Groups(): React.JSX.Element {
  const { items, accounts, error, setError, reload } = useTeam<PersonGroup>('/api/groups', 'groups')
  const [name, setName] = useState('')
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(message(e))
    }
  }
  return (
    <div className="accounts">
      <p className="settings-note">
        Un groupe (ex. « Équipe produit ») se choisit dans le menu Partager d’une page : ses
        membres, présents et futurs, y ont accès.
      </p>
      <form
        className="new-account"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await json('/api/groups', { json: { name } })
            setName('')
          })
        }}
      >
        <div className="new-account-fields">
          <input
            placeholder="Nom du groupe"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" type="submit">
            Créer le groupe
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        <p className="settings-note">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="settings-note">Aucun groupe pour l’instant.</p>
      ) : (
        items.map((g) => (
          <section key={g.id} className="team-item">
            <header>
              <input
                aria-label="Nom du groupe"
                defaultValue={g.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== g.name)
                    void run(() =>
                      json(`/api/groups/${encodeURIComponent(g.id)}`, {
                        method: 'PATCH',
                        json: { name: e.target.value }
                      })
                    )
                }}
              />
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`Supprimer le groupe « ${g.name} » ? Ses partages s’arrêtent.`))
                    void run(() =>
                      json(`/api/groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' })
                    )
                }}
              >
                Supprimer
              </button>
            </header>
            <MemberPicker
              accounts={accounts}
              value={g.memberIds}
              onChange={(memberIds) =>
                void run(() =>
                  json(`/api/groups/${encodeURIComponent(g.id)}`, {
                    method: 'PATCH',
                    json: { memberIds }
                  })
                )
              }
            />
          </section>
        ))
      )}
    </div>
  )
}

/** Workspaces: each has its own pages, open to its members (and the administrators). */
export function Workspaces(): React.JSX.Element {
  const { items, accounts, error, setError, reload } = useTeam<WorkspaceInfo>(
    '/api/workspaces',
    'workspaces'
  )
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(message(e))
    }
  }
  const patch = (w: WorkspaceInfo, body: Record<string, unknown>): Promise<void> =>
    run(() => json(`/api/workspaces/${encodeURIComponent(w.id)}`, { method: 'PATCH', json: body }))
  return (
    <div className="accounts">
      <p className="settings-note">
        Chaque espace a ses propres pages, bases et fichiers. L’espace principal est ouvert à tous
        les comptes ; les autres à leurs membres et aux administrateurs. On change d’espace en haut
        de la barre latérale.
      </p>
      <form
        className="new-account"
        onSubmit={(e) => {
          e.preventDefault()
          void run(async () => {
            await json('/api/workspaces', { json: { name, icon: icon || null } })
            setName('')
            setIcon('')
          })
        }}
      >
        <div className="new-account-fields">
          <input
            className="emoji-input"
            placeholder="🏢"
            maxLength={4}
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
          />
          <input
            placeholder="Nom de l’espace"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" type="submit">
            Créer l’espace
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        <p className="settings-note">Chargement…</p>
      ) : (
        items.map((w) => (
          <section key={w.id} className="team-item">
            <header>
              <input
                className="emoji-input"
                aria-label="Icône"
                defaultValue={w.icon ?? ''}
                placeholder="🏢"
                maxLength={4}
                onBlur={(e) => {
                  if (e.target.value !== (w.icon ?? ''))
                    void patch(w, { icon: e.target.value || null })
                }}
              />
              <input
                aria-label="Nom de l’espace"
                defaultValue={w.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== w.name)
                    void patch(w, { name: e.target.value })
                }}
              />
            </header>
            {w.memberIds === null ? (
              <p className="settings-note">Tous les comptes.</p>
            ) : (
              <MemberPicker
                accounts={accounts.filter((a) => a.role !== 'admin')}
                value={w.memberIds}
                onChange={(memberIds) => void patch(w, { memberIds })}
              />
            )}
          </section>
        ))
      )}
    </div>
  )
}
