import { useEffect, useState } from 'react'
import type { SessionUser } from '../shared/collab'
import type { ServerLinkStatus, ServerLoginError } from '../shared/desktop'
import { t } from '../shared/i18n'

const messageOf = (error: ServerLoginError): string =>
  error.kind === 'certificate'
    ? t(
        'Cet ordinateur ne reconnaît pas le certificat du serveur : installez le certificat de son autorité (notionix-ca.crt, fourni par le serveur), puis réessayez.'
      )
    : error.kind === 'unreachable'
      ? t('Serveur injoignable : vérifiez l’adresse et le réseau.')
      : // The server writes in French: its fixed messages are translated here.
        t(error.message)

/** Plain HTTP to another machine: passwords and pages travel unencrypted. */
const unencrypted = (url: string): boolean =>
  /^http:\/\//i.test(url.trim()) &&
  !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url.trim())

/**
 * Links the desktop app to a Notionix server (or signs in again when the
 * session has ended). The app then starts again with the team's pages next
 * to the private ones, which stay on this computer.
 */
export function ConnectDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const server = window.desktop!.server
  const [status, setStatus] = useState<ServerLinkStatus | null>(null)
  const [url, setUrl] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Signed in with a provisional password: it is replaced first.
  const [provisional, setProvisional] = useState<{
    user: SessionUser
    MyAccount: React.ComponentType<{ user: SessionUser; required?: boolean }>
  } | null>(null)

  useEffect(() => {
    void server.status().then((s) => {
      if (!s) return
      setStatus(s)
      setUrl(s.url)
      setEmail(s.email)
    })
  }, [server])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await server
      .login(url, email, password)
      .catch(() => ({ ok: false as const, error: { kind: 'unreachable' as const } }))
    if (!result.ok) {
      setError(messageOf(result.error))
      setBusy(false)
      return
    }
    if (result.status.user.mustChangePassword) {
      const [{ setTransport }, { desktopTransport }, { MyAccount }] = await Promise.all([
        import('../web/http'),
        import('./transport'),
        import('../web/SettingsDialog')
      ])
      setTransport(desktopTransport(server))
      setProvisional({ user: result.status.user, MyAccount })
      return
    }
    location.reload()
  }

  if (provisional)
    return (
      <div className="overlay">
        <div className="dialog server-connect">
          <provisional.MyAccount user={provisional.user} required />
        </div>
      </div>
    )

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog server-connect"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h3>{status ? t('Se reconnecter au serveur') : t('Se connecter à un serveur Notionix')}</h3>
        <p className="server-connect-hint">
          {t(
            'Les pages de l’équipe sont sur le serveur. Vos pages privées restent sur cet ordinateur et n’y sont jamais envoyées.'
          )}
        </p>
        {status && !status.signedIn && (
          <p className="server-connect-hint">
            {t('Votre session a pris fin : entrez à nouveau votre mot de passe.')}
          </p>
        )}
        <label>
          {t('Adresse du serveur')}
          <input
            type="text"
            placeholder="https://192.168.1.10:8443"
            autoFocus={!status}
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          {t('E-mail')}
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          {t('Mot de passe')}
          <input
            type="password"
            autoComplete="current-password"
            autoFocus={status !== null}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {unencrypted(url) && (
          <p className="server-connect-warning">
            {t('Connexion non chiffrée (HTTP) : réservée aux essais sur le réseau local.')}
          </p>
        )}
        {error && (
          <p className="server-connect-error" role="alert">
            {error}
          </p>
        )}
        <div className="server-connect-buttons">
          <button type="button" onClick={onClose}>
            {t('Annuler')}
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t('Connexion…') : t('Se connecter')}
          </button>
        </div>
      </form>
    </div>
  )
}
