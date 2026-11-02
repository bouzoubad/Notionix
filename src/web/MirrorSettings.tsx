import { useEffect, useState } from 'react'
import type { MirrorStatus } from '../shared/collab'
import { json } from './http'
import { locale, t } from '../shared/i18n'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const when = (ms: number | null): string =>
  ms === null
    ? '—'
    : new Date(ms).toLocaleString(locale(), {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })

/**
 * Administrators: the Git mirror of the pages open to the whole main
 * workspace (Markdown, committed after each batch of changes and pushed).
 * The repository's access token is typed here and never shown again.
 */
export function MirrorSettings(): React.JSX.Element {
  const [status, setStatus] = useState<MirrorStatus | null>(null)
  const [remote, setRemote] = useState('')
  const [token, setToken] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const show = (s: MirrorStatus): void => {
    setStatus(s)
    setRemote(s.remote ?? '')
    setBranch(s.branch)
    setToken('')
  }
  useEffect(() => {
    let cancelled = false
    json<{ mirror: MirrorStatus }>('/api/admin/mirror')
      .then(({ mirror }) => !cancelled && show(mirror))
      .catch((e) => !cancelled && setError(message(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const act = async (what: string, run: () => Promise<{ mirror: MirrorStatus }>): Promise<void> => {
    setBusy(what)
    setError(null)
    try {
      show((await run()).mirror)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  if (!status) return error ? <p className="error">{error}</p> : <></>
  return (
    <div className="mirror-settings">
      <h4>{t('Miroir git')}</h4>
      <p className="settings-note">
        {t(
          'Copie Markdown des pages ouvertes à tout l’espace principal, envoyée dans un dépôt git une minute après chaque modification (au plus tard toutes les 10 minutes) ; l’auteur de chaque commit est la personne qui a modifié. Les pages privées, partagées à quelques personnes, et les commentaires n’y vont pas. Le dépôt ne doit pas être modifié à la main.'
        )}
      </p>
      {status.configured && (
        <p className="settings-note mirror-state">
          {status.error ? (
            <span className="error">{t('Problème : {error}', { error: status.error })}</span>
          ) : status.unpushed ? (
            t('Commits en attente d’envoi.')
          ) : status.pending ? (
            t('Modifications en attente d’export.')
          ) : (
            t('À jour.')
          )}{' '}
          {t('Dernier commit : {when}', { when: when(status.lastCommitAt) })}
          {status.lastCommit ? ` — ${status.lastCommit}` : ''}
          {'. '}
          {t('Dernier envoi : {when}.', { when: when(status.lastPushAt) })}
          {status.skipped > 0 &&
            ` ${t('{n} fichier(s) de plus de 25 Mo laissé(s) de côté.', { n: status.skipped })}`}
        </p>
      )}
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          void act('save', () =>
            json('/api/admin/mirror', {
              method: 'PUT',
              json: { remote, branch, ...(token ? { token } : {}) }
            })
          )
        }}
      >
        <label>
          {t('Adresse HTTPS du dépôt')}
          <input
            type="url"
            required
            placeholder="https://bitbucket.org/equipe/notionix-miroir.git"
            value={remote}
            onChange={(e) => setRemote(e.target.value)}
          />
        </label>
        <label>
          {t('Jeton d’accès du dépôt (lecture et écriture)')}
          <input
            type="password"
            autoComplete="off"
            placeholder={status.hasToken ? t('Enregistré : laisser vide pour le garder') : ''}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <label>
          {t('Branche')}
          <input type="text" required value={branch} onChange={(e) => setBranch(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="mirror-actions">
          <button className="primary" type="submit" disabled={busy !== null}>
            {busy === 'save' ? t('Vérification du dépôt…') : t('Enregistrer')}
          </button>
          {status.configured && (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void act('sync', () => json('/api/admin/mirror/sync', { method: 'POST' }))
                }
              >
                {busy === 'sync' ? t('Synchronisation…') : t('Synchroniser maintenant')}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (!confirm(t('Arrêter le miroir ? Le dépôt garde son historique.'))) return
                  void act('off', () => json('/api/admin/mirror', { method: 'DELETE' }))
                }}
              >
                {t('Désactiver')}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
