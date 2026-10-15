import { useEffect, useState } from 'react'
import type { AdminOverview, AuditEntry, SessionUser } from '../shared/collab'
import { json } from './http'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const bytes = (n: number): string =>
  n === 0
    ? '0 Ko'
    : n < 1024 * 1024
      ? `${Math.max(1, Math.round(n / 1024))} Ko`
      : n < 1024 ** 3
        ? `${(n / 1024 / 1024).toFixed(1)} Mo`
        : `${(n / 1024 ** 3).toFixed(2)} Go`
const when = (ms: number): string =>
  new Date(ms).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

/** What each audited action means, for the log. */
const ACTIONS: Record<string, string> = {
  login: 'Connexion',
  'login.failed': 'Connexion refusée',
  'user.create': 'Compte créé',
  'user.update': 'Compte modifié',
  'user.activation': 'Lien d’activation créé',
  'user.activated': 'Compte activé',
  'user.password': 'Mot de passe provisoire créé',
  'user.transfer': 'Pages transférées',
  'sessions.end': 'Sessions fermées',
  'token.create': 'Jeton d’API créé',
  'token.revoke': 'Jeton d’API révoqué',
  'group.create': 'Groupe créé',
  'group.update': 'Groupe modifié',
  'group.delete': 'Groupe supprimé',
  'workspace.create': 'Espace créé',
  'workspace.update': 'Espace modifié',
  'workspace.archive': 'Espace archivé',
  'workspace.restore': 'Espace restauré',
  'workspace.delete': 'Espace supprimé',
  'pages.setShare': 'Partage d’une page',
  'pages.setAccess': 'Accès d’une page',
  'pages.publish': 'Publication web',
  'pages.trash': 'Page à la corbeille',
  'pages.restore': 'Page restaurée',
  'pages.deleteForever': 'Page supprimée définitivement',
  'pages.restoreVersion': 'Version restaurée',
  'databases.importCsv': 'Import CSV',
  'transfer.import': 'Import Notion',
  'transfer.export': 'Export'
}

interface Account extends SessionUser {
  disabled: boolean
}

/** Administrators: the server at a glance, who is connected, and the audit log. */
export function AdminDashboard(): React.JSX.Element {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState<string | null>(null)
  const reload = async (): Promise<void> => {
    const [{ overview }, { users }] = await Promise.all([
      json<{ overview: AdminOverview }>('/api/admin/overview'),
      json<{ users: Account[] }>('/api/users')
    ])
    setOverview(overview)
    setAccounts(users)
  }
  useEffect(() => {
    let cancelled = false
    Promise.all([
      json<{ overview: AdminOverview }>('/api/admin/overview'),
      json<{ users: Account[] }>('/api/users')
    ])
      .then(([o, u]) => {
        if (cancelled) return
        setOverview(o.overview)
        setAccounts(u.users)
      })
      .catch((e) => !cancelled && setError(message(e)))
    return () => {
      cancelled = true
    }
  }, [])
  const name = (id: string | null): string =>
    id === null ? '—' : (accounts.find((a) => a.id === id)?.name ?? id)

  if (error) return <p className="error">{error}</p>
  if (!overview) return <p className="settings-note">Chargement…</p>
  const { users } = overview
  return (
    <div className="admin-dashboard">
      <div className="admin-cards">
        <div className="admin-card">
          <strong>{users.active}</strong>
          <span>comptes actifs</span>
          <small>
            {users.admins} admin · {users.disabled} désactivé(s) · {users.pending} à activer
          </small>
        </div>
        <div className="admin-card">
          <strong>{overview.online.length}</strong>
          <span>connecté(s) maintenant</span>
          <small>{overview.online.map(name).join(', ') || 'personne'}</small>
        </div>
        <div className="admin-card">
          <strong>{bytes(overview.totalBytes)}</strong>
          <span>de données</span>
          <small>bases et fichiers, tous espaces</small>
        </div>
        <div className="admin-card">
          <strong>{overview.feedbackOpen}</strong>
          <span>retour(s) à traiter</span>
          <small>bugs et idées</small>
        </div>
      </div>

      <h4>Espaces de travail</h4>
      <table className="accounts-table">
        <thead>
          <tr>
            <th>Espace</th>
            <th>Pages</th>
            <th>Bases</th>
            <th>Corbeille</th>
            <th>Membres</th>
            <th>Base</th>
            <th>Fichiers</th>
          </tr>
        </thead>
        <tbody>
          {overview.workspaces.map((w) => (
            <tr key={w.id} className={w.archived ? 'disabled' : ''}>
              <td>
                {w.name}
                {w.archived && <span className="account-badge">archivé</span>}
              </td>
              <td>{w.pages}</td>
              <td>{w.databases}</td>
              <td>{w.trashed}</td>
              <td>{w.members ?? 'tous'}</td>
              <td>{bytes(w.databaseBytes)}</td>
              <td>
                {w.files} · {bytes(w.fileBytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Sessions ouvertes</h4>
      {overview.sessions.length === 0 ? (
        <p className="settings-note">Aucune.</p>
      ) : (
        <table className="accounts-table">
          <thead>
            <tr>
              <th>Personne</th>
              <th>Sessions</th>
              <th>Dernière connexion</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {overview.sessions.map((s) => (
              <tr key={s.userId}>
                <td>{name(s.userId)}</td>
                <td>{s.count}</td>
                <td>{when(s.lastAt)}</td>
                <td className="account-actions">
                  <button
                    onClick={async () => {
                      if (!confirm(`Fermer les sessions de ${name(s.userId)} ?`)) return
                      await json(`/api/admin/sessions/${encodeURIComponent(s.userId)}`, {
                        method: 'DELETE'
                      })
                      await reload()
                    }}
                  >
                    Déconnecter
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AuditLog accounts={accounts} name={name} />
    </div>
  )
}

function AuditLog({
  accounts,
  name
}: {
  accounts: Account[]
  name: (id: string | null) => string
}): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [more, setMore] = useState(false)
  const query = (before?: number): string => {
    const q = new URLSearchParams()
    if (action) q.set('action', action)
    if (actor) q.set('actor', actor)
    if (before) q.set('before', String(before))
    return `/api/admin/audit?${q}`
  }
  useEffect(() => {
    let cancelled = false
    const q = new URLSearchParams()
    if (action) q.set('action', action)
    if (actor) q.set('actor', actor)
    json<{ entries: AuditEntry[] }>(`/api/admin/audit?${q}`).then(({ entries }) => {
      if (cancelled) return
      setEntries(entries)
      setMore(entries.length === 100)
    })
    return () => {
      cancelled = true
    }
  }, [action, actor])
  const loadMore = async (): Promise<void> => {
    const last = entries?.at(-1)
    if (!last) return
    const { entries: next } = await json<{ entries: AuditEntry[] }>(query(last.id))
    setEntries([...(entries ?? []), ...next])
    setMore(next.length === 100)
  }
  // Pages and accounts are named when known; other targets stay as ids.
  const target = (e: AuditEntry): string =>
    e.target && accounts.some((a) => a.id === e.target) ? name(e.target) : (e.target ?? '')

  return (
    <>
      <h4>Journal d’audit</h4>
      <div className="feedback-filters">
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Toutes les actions</option>
          {Object.entries(ACTIONS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Personne" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">Tout le monde</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {entries === null ? (
        <p className="settings-note">Chargement…</p>
      ) : entries.length === 0 ? (
        <p className="settings-note">Rien à afficher.</p>
      ) : (
        <table className="accounts-table audit-table">
          <thead>
            <tr>
              <th>Quand</th>
              <th>Qui</th>
              <th>Action</th>
              <th>Sur</th>
              <th>Détail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{when(e.at)}</td>
                <td>{name(e.actorId)}</td>
                <td>{ACTIONS[e.action] ?? e.action}</td>
                <td className="audit-target">{target(e)}</td>
                <td className="audit-detail">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more && <button onClick={() => void loadMore()}>Plus ancien…</button>}
      <p className="settings-note">Conservé un an.</p>
    </>
  )
}
