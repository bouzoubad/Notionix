import { useEffect, useState } from 'react'
import type { SessionUser } from '../shared/collab'
import { json } from './http'
import { Groups, Workspaces } from './TeamSettings'
import { KeeperShare, type SignInKey } from './KeeperShare'
import { AdminDashboard } from './AdminDashboard'

type Role = SessionUser['role']

interface Account extends SessionUser {
  disabled: boolean
  createdAt: number
  pendingActivation: boolean
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
  const [tab, setTab] = useState<
    'me' | 'dashboard' | 'accounts' | 'groups' | 'workspaces' | 'tokens'
  >(user.role === 'admin' ? 'dashboard' : 'me')
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog settings" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Paramètres</h3>
        <div className="settings-tabs">
          {user.role === 'admin' && (
            <button
              className={tab === 'dashboard' ? 'active' : ''}
              onClick={() => setTab('dashboard')}
            >
              Tableau de bord
            </button>
          )}
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
          {tab === 'dashboard' ? (
            <AdminDashboard />
          ) : tab === 'accounts' ? (
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

/** One's own password: from the settings, or first thing after a provisional one. */
export function MyAccount({
  user,
  required = false
}: {
  user: SessionUser
  required?: boolean
}): React.JSX.Element {
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
      {required && (
        <p className="settings-notice">
          Votre mot de passe est provisoire : choisissez le vôtre pour continuer.
        </p>
      )}
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
  const [key, setKey] = useState<SignInKey | null>(null)
  const [leaving, setLeaving] = useState<Account | null>(null)

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

  const run = async (fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setError(null)
    setNotice(null)
    try {
      await fn()
      await reload()
      if (done) setNotice(done)
    } catch (e) {
      setError(message(e))
      await reload()
    }
  }
  const change = (
    account: Account,
    patch: { role?: Role; disabled?: boolean },
    done?: string
  ): Promise<void> =>
    run(async () => {
      await json(`/api/users/${encodeURIComponent(account.id)}`, { method: 'PATCH', json: patch })
      // Changing one's own role ends this session.
      if (account.id === self.id && patch.role) location.reload()
    }, done)
  /** A new sign-in key for an existing account (forgotten password…). */
  const newKey = (account: Account, kind: 'activation' | 'password'): Promise<void> =>
    run(async () => {
      const result = await json<{ activation?: SignInKey['activation']; password?: string }>(
        `/api/users/${encodeURIComponent(account.id)}/${kind}`,
        { method: 'POST' }
      )
      setKey({ name: account.name, email: account.email, ...result })
    })

  return (
    <div className="accounts">
      {key ? (
        <KeeperShare credentials={key} onClose={() => setKey(null)} />
      ) : (
        <NewAccount
          onCreated={async (created) => {
            await reload()
            setError(null)
            setKey(created)
          }}
        />
      )}
      {leaving && accounts && (
        <TransferPages
          account={leaving}
          accounts={accounts}
          onDone={(text) => {
            setLeaving(null)
            void run(async () => undefined, text)
          }}
          onCancel={() => setLeaving(null)}
        />
      )}
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
                  {a.pendingActivation && <span className="account-badge">à activer</span>}
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
                  <select
                    aria-label={`Actions pour ${a.email}`}
                    value=""
                    onChange={(e) => {
                      const action = e.target.value
                      if (action === 'link') void newKey(a, 'activation')
                      if (action === 'password') void newKey(a, 'password')
                      if (action === 'transfer') setLeaving(a)
                      if (action === 'toggle')
                        void change(
                          a,
                          { disabled: !a.disabled },
                          a.disabled ? `${a.email} réactivé.` : `${a.email} désactivé.`
                        )
                    }}
                  >
                    <option value="">Actions…</option>
                    <option value="link">Nouveau lien d’activation (Keeper)</option>
                    <option value="password">Mot de passe provisoire (Keeper)</option>
                    {a.id !== self.id && <option value="transfer">Transférer ses pages…</option>}
                    {a.id !== self.id && (
                      <option value="toggle">{a.disabled ? 'Réactiver' : 'Désactiver'}</option>
                    )}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="settings-note">
        Un compte désactivé ne peut plus se connecter ; ses pages restent. Un mot de passe
        provisoire ferme les sessions ouvertes de la personne et doit être changé à sa connexion. Un
        lien d’activation sert aussi en cas de mot de passe oublié.
      </p>
    </div>
  )
}

/** Someone leaves: their private pages go to another person, then the account can be disabled. */
function TransferPages({
  account,
  accounts,
  onDone,
  onCancel
}: {
  account: Account
  accounts: Account[]
  onDone: (notice: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [to, setTo] = useState('')
  const [disable, setDisable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      const { pages } = await json<{ pages: number }>(
        `/api/users/${encodeURIComponent(account.id)}/transfer`,
        { json: { to, disable } }
      )
      const recipient = accounts.find((a) => a.id === to)?.name ?? ''
      onDone(
        `${pages} page(s) privée(s) de ${account.name} confiée(s) à ${recipient}${disable ? ', compte désactivé' : ''}.`
      )
    } catch (err) {
      setError(message(err))
    }
  }
  return (
    <form className="new-account transfer-pages" onSubmit={(e) => void submit(e)}>
      <h4>Départ de {account.name}</h4>
      <p className="settings-note">
        Ses pages privées (et leurs sous-pages), dans tous les espaces, passent à la personne
        choisie. Les pages partagées avec tout l’espace ne changent pas.
      </p>
      <div className="new-account-fields">
        <select required value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Confier ses pages à…</option>
          {accounts
            .filter((a) => a.id !== account.id && !a.disabled)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.email})
              </option>
            ))}
        </select>
        <label className="inline-check">
          <input type="checkbox" checked={disable} onChange={(e) => setDisable(e.target.checked)} />
          Désactiver le compte
        </label>
        <button className="primary" type="submit" disabled={!to}>
          Transférer
        </button>
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function NewAccount({
  onCreated
}: {
  onCreated: (key: SignInKey) => Promise<void>
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [mode, setMode] = useState<'link' | 'password'>('link')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await json<{
        user: Account
        password?: string
        activation?: SignInKey['activation']
      }>('/api/users', { json: { email, name, role, mode } })
      await onCreated({
        name: result.user.name,
        email: result.user.email,
        password: result.password,
        activation: result.activation
      })
      setEmail('')
      setName('')
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
        <button className="primary" type="submit" disabled={busy}>
          Créer
        </button>
      </div>
      <div className="new-account-mode">
        <label>
          <input type="radio" checked={mode === 'link'} onChange={() => setMode('link')} />
          Lien d’activation : la personne choisit son mot de passe (recommandé)
        </label>
        <label>
          <input type="radio" checked={mode === 'password'} onChange={() => setMode('password')} />
          Mot de passe provisoire généré, à changer à la première connexion
        </label>
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
