import { useEffect, useState } from 'react'
import type { SessionUser } from '../shared/collab'
import { json } from './http'
import { Groups, Workspaces } from './TeamSettings'

type Role = SessionUser['role']

interface Account extends SessionUser {
  disabled: boolean
  createdAt: number
}

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  editor: 'Éditeur',
  reader: 'Lecture seule',
  guest: 'Invité (pages partagées)'
}
const MIN_PASSWORD = 10

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Account settings: one's own password, and the team's accounts for administrators. */
export function SettingsDialog({
  user,
  onClose
}: {
  user: SessionUser
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'me' | 'accounts' | 'groups' | 'workspaces' | 'tokens'>(
    user.role === 'admin' ? 'accounts' : 'me'
  )
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog settings" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Paramètres</h3>
        <div className="settings-tabs">
          {user.role === 'admin' && (
            <button
              className={tab === 'accounts' ? 'active' : ''}
              onClick={() => setTab('accounts')}
            >
              Comptes de l’équipe
            </button>
          )}
          {user.role === 'admin' && (
            <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
              Groupes
            </button>
          )}
          {user.role === 'admin' && (
            <button
              className={tab === 'workspaces' ? 'active' : ''}
              onClick={() => setTab('workspaces')}
            >
              Espaces de travail
            </button>
          )}
          <button className={tab === 'me' ? 'active' : ''} onClick={() => setTab('me')}>
            Mon compte
          </button>
          <button className={tab === 'tokens' ? 'active' : ''} onClick={() => setTab('tokens')}>
            Jetons d’API
          </button>
        </div>
        <div className="settings-body">
          {tab === 'accounts' ? (
            <Accounts self={user} />
          ) : tab === 'groups' ? (
            <Groups />
          ) : tab === 'workspaces' ? (
            <Workspaces />
          ) : tab === 'tokens' ? (
            <Tokens />
          ) : (
            <MyAccount user={user} />
          )}
        </div>
      </div>
    </div>
  )
}

function MyAccount({ user }: { user: SessionUser }): React.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (next !== again) return setError('Les deux nouveaux mots de passe diffèrent.')
    setBusy(true)
    setError(null)
    try {
      await json('/api/me/password', { json: { current, next } })
      // Changing the password ends every session, this one included.
      alert('Mot de passe changé. Reconnectez-vous avec le nouveau.')
      location.reload()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <form className="settings-form" onSubmit={(e) => void submit(e)}>
      <p className="settings-note">
        {user.name} · {user.email} · {ROLE_LABELS[user.role]}
      </p>
      <label>
        Mot de passe actuel
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label>
        Nouveau mot de passe ({MIN_PASSWORD} caractères minimum)
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label>
        Nouveau mot de passe, à nouveau
        <input
          type="password"
          autoComplete="new-password"
          required
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        Changer le mot de passe
      </button>
    </form>
  )
}

function Accounts({ self }: { self: SessionUser }): React.JSX.Element {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    const { users } = await json<{ users: Account[] }>('/api/users')
    setAccounts(users)
  }
  useEffect(() => {
    let cancelled = false
    json<{ users: Account[] }>('/api/users')
      .then(({ users }) => !cancelled && setAccounts(users))
      .catch((e) => !cancelled && setError(message(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const change = async (
    account: Account,
    patch: { role?: Role; disabled?: boolean; password?: string },
    done?: string
  ): Promise<void> => {
    setError(null)
    setNotice(null)
    try {
      await json(`/api/users/${encodeURIComponent(account.id)}`, { method: 'PATCH', json: patch })
      // Changing one's own role or password ends this session.
      if (account.id === self.id && (patch.role || patch.password)) return location.reload()
      await reload()
      if (done) setNotice(done)
    } catch (e) {
      setError(message(e))
      await reload()
    }
  }

  const resetPassword = (account: Account): void => {
    const password = prompt(
      `Nouveau mot de passe pour ${account.email} (${MIN_PASSWORD} caractères minimum). Communiquez-le à la personne ; ses sessions ouvertes sont fermées.`
    )
    if (password) void change(account, { password }, `Mot de passe de ${account.email} changé.`)
  }

  return (
    <div className="accounts">
      <NewAccount
        onCreated={async (email) => {
          await reload()
          setError(null)
          setNotice(`Compte créé : ${email}. Communiquez-lui son mot de passe.`)
        }}
      />
      {notice && <p className="settings-notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {accounts === null ? (
        <p className="settings-note">Chargement…</p>
      ) : (
        <table className="accounts-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>E-mail</th>
              <th>Rôle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={a.disabled ? 'disabled' : ''}>
                <td>
                  {a.name}
                  {a.id === self.id ? ' (vous)' : ''}
                </td>
                <td>{a.email}</td>
                <td>
                  <select
                    value={a.role}
                    onChange={(e) => void change(a, { role: e.target.value as Role })}
                  >
                    {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="account-actions">
                  <span>
                    <button onClick={() => resetPassword(a)}>Mot de passe…</button>
                    {a.id !== self.id && (
                      <button onClick={() => void change(a, { disabled: !a.disabled })}>
                        {a.disabled ? 'Réactiver' : 'Désactiver'}
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="settings-note">
        Un compte désactivé ne peut plus se connecter ; ses pages restent. Changer un rôle ou un mot
        de passe ferme les sessions ouvertes de la personne.
      </p>
    </div>
  )
}

function NewAccount({
  onCreated
}: {
  onCreated: (email: string) => Promise<void>
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await json('/api/users', { json: { email, name, role, password } })
      await onCreated(email)
      setEmail('')
      setName('')
      setPassword('')
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="new-account" onSubmit={(e) => void submit(e)}>
      <h4>Ajouter un compte</h4>
      <div className="new-account-fields">
        <input
          type="text"
          placeholder="Prénom Nom"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="email"
          placeholder="e-mail"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder={`mot de passe provisoire (${MIN_PASSWORD}+)`}
          autoComplete="off"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" type="submit" disabled={busy}>
          Créer
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

interface ApiToken {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

/** Personal API tokens: scripts and integrations act as this person. */
function Tokens(): React.JSX.Element {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = async (): Promise<void> => {
    setTokens((await json<{ tokens: ApiToken[] }>('/api/tokens')).tokens)
  }
  useEffect(() => {
    let cancelled = false
    json<{ tokens: ApiToken[] }>('/api/tokens')
      .then(({ tokens }) => !cancelled && setTokens(tokens))
      .catch((e) => !cancelled && setError(message(e)))
    return () => {
      cancelled = true
    }
  }, [])
  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const { token } = await json<{ token: string }>('/api/tokens', { json: { name } })
      setCreated(token)
      setName('')
      await reload()
    } catch (err) {
      setError(message(err))
    }
  }
  const when = (ms: number | null): string => (ms ? new Date(ms).toLocaleString('fr-FR') : 'jamais')
  return (
    <div className="accounts">
      <p className="settings-note">
        Un jeton permet à un script d’utiliser l’API de Notionix avec vos droits (en-tête «
        Authorization: Bearer … »). Documentation : docs/api.md du dépôt.
      </p>
      <form className="new-account" onSubmit={(e) => void create(e)}>
        <div className="new-account-fields">
          <input
            placeholder="Nom du jeton (ex. Import tableur)"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" type="submit">
            Créer un jeton
          </button>
        </div>
      </form>
      {created && (
        <p className="settings-notice">
          Copiez ce jeton maintenant, il ne sera plus affiché :{' '}
          <code className="token">{created}</code>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <table className="accounts-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Créé le</th>
            <th>Dernière utilisation</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens?.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{when(t.createdAt)}</td>
              <td>{when(t.lastUsedAt)}</td>
              <td className="account-actions">
                <span>
                  <button
                    onClick={async () => {
                      if (!confirm(`Révoquer le jeton « ${t.name} » ?`)) return
                      await json(`/api/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE' })
                      await reload()
                    }}
                  >
                    Révoquer
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
