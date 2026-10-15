import { useEffect, useState } from 'react'
import type { AdminOverview, AuditEntry, SessionUser } from '../shared/collab'
import { json } from './http'
import { locale, t, tx } from '../shared/i18n'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const bytes = (n: number): string =>
  n === 0
    ? t('{n} Ko', { n: 0 })
    : n < 1024 * 1024
      ? t('{n} Ko', { n: Math.max(1, Math.round(n / 1024)) })
      : n < 1024 ** 3
        ? t('{n} Mo', { n: (n / 1024 / 1024).toFixed(1) })
        : t('{n} Go', { n: (n / 1024 ** 3).toFixed(2) })
const when = (ms: number): string =>
  new Date(ms).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

/** What each audited action means, for the log. */
const ACTIONS: Record<string, string> = {
  login: t('Connexion'),
  'login.failed': t('Connexion refusée'),
  'user.create': t('Compte créé'),
  'user.update': t('Compte modifié'),
  'user.activation': t('Lien d’activation créé'),
  'user.activated': t('Compte activé'),
  'user.password': t('Mot de passe provisoire créé'),
  'user.transfer': t('Pages transférées'),
  'sessions.end': t('Sessions fermées'),
  'token.create': t('Jeton d’API créé'),
  'token.revoke': t('Jeton d’API révoqué'),
  'group.create': t('Groupe créé'),
  'group.update': t('Groupe modifié'),
  'group.delete': t('Groupe supprimé'),
  'workspace.create': t('Espace créé'),
  'workspace.update': t('Espace modifié'),
  'workspace.archive': t('Espace archivé'),
  'workspace.restore': t('Espace restauré'),
  'workspace.delete': t('Espace supprimé'),
  'pages.setShare': t('Partage d’une page'),
  'pages.setAccess': t('Accès d’une page'),
  'pages.publish': t('Publication web'),
  'pages.trash': t('Page à la corbeille'),
  'pages.restore': t('Page restaurée'),
  'pages.deleteForever': t('Page supprimée définitivement'),
  'pages.restoreVersion': t('Version restaurée'),
  'databases.importCsv': t('Import CSV'),
  'transfer.import': t('Import Notion'),
  'transfer.export': t('Export')
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
  if (!overview) return <p className="settings-note">{t('Chargement…')}</p>
  const { users } = overview
  return (
    <div className="admin-dashboard">
      <div className="admin-cards">
        <div className="admin-card">
          <strong>{users.active}</strong>
          <span>{t('comptes actifs')}</span>
          <small>
            {t('{admins} admin · {disabled} désactivé(s) · {pending} à activer', {
              admins: users.admins,
              disabled: users.disabled,
              pending: users.pending
            })}
          </small>
        </div>
        <div className="admin-card">
          <strong>{overview.online.length}</strong>
          <span>{t('connecté(s) maintenant')}</span>
          <small>{overview.online.map(name).join(', ') || tx('aucun', 'personne')}</small>
        </div>
        <div className="admin-card">
          <strong>{bytes(overview.totalBytes)}</strong>
          <span>{t('de données')}</span>
          <small>{t('bases et fichiers, tous espaces')}</small>
        </div>
        <div className="admin-card">
          <strong>{overview.feedbackOpen}</strong>
          <span>{t('retour(s) à traiter')}</span>
          <small>{t('bugs et idées')}</small>
        </div>
      </div>

      <h4>{t('Espaces de travail')}</h4>
      <table className="accounts-table">
        <thead>
          <tr>
            <th>{t('Espace')}</th>
            <th>{t('Pages')}</th>
            <th>{t('Bases')}</th>
            <th>{t('Corbeille')}</th>
            <th>{t('Membres')}</th>
            <th>{t('Base')}</th>
            <th>{t('Fichiers')}</th>
          </tr>
        </thead>
        <tbody>
          {overview.workspaces.map((w) => (
            <tr key={w.id} className={w.archived ? 'disabled' : ''}>
              <td>
                {w.name}
                {w.archived && <span className="account-badge">{t('archivé')}</span>}
              </td>
              <td>{w.pages}</td>
              <td>{w.databases}</td>
              <td>{w.trashed}</td>
              <td>{w.members ?? t('tous')}</td>
              <td>{bytes(w.databaseBytes)}</td>
              <td>
                {w.files} · {bytes(w.fileBytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>{t('Sessions ouvertes')}</h4>
      {overview.sessions.length === 0 ? (
        <p className="settings-note">{t('Aucune.')}</p>
      ) : (
        <table className="accounts-table">
          <thead>
            <tr>
              <th>{t('Personne')}</th>
              <th>{t('Sessions')}</th>
              <th>{t('Dernière connexion')}</th>
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
                      if (!confirm(t('Fermer les sessions de {name} ?', { name: name(s.userId) })))
                        return
                      await json(`/api/admin/sessions/${encodeURIComponent(s.userId)}`, {
                        method: 'DELETE'
                      })
                      await reload()
                    }}
                  >
                    {t('Déconnecter')}
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
      <h4>{t('Journal d’audit')}</h4>
      <div className="feedback-filters">
        <select aria-label={t('Action')} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">{t('Toutes les actions')}</option>
          {Object.entries(ACTIONS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label={t('Personne')} value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">{t('Tout le monde')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {entries === null ? (
        <p className="settings-note">{t('Chargement…')}</p>
      ) : entries.length === 0 ? (
        <p className="settings-note">{t('Rien à afficher.')}</p>
      ) : (
        <table className="accounts-table audit-table">
          <thead>
            <tr>
              <th>{t('Quand')}</th>
              <th>{t('Qui')}</th>
              <th>{t('Action')}</th>
              <th>{t('Sur')}</th>
              <th>{t('Détail')}</th>
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
      {more && <button onClick={() => void loadMore()}>{t('Plus ancien…')}</button>}
      <p className="settings-note">{t('Conservé un an.')}</p>
    </>
  )
}
