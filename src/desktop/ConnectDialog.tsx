import { useEffect, useState } from 'react'
// The dialogs shared with the web client (feedback, account, administration) are styled there.
import '../web/web.css'
import type { SessionUser } from '../shared/collab'
import {
  parseActivationLink,
  type ActivationInfo,
  type ServerLinkStatus,
  type ServerLoginError
} from '../shared/desktop'
import { t } from '../shared/i18n'

/** The server's rule (auth.ts), checked here first. */
const MIN_PASSWORD = 10

const messageOf = (error: ServerLoginError): string =>
  error.kind === 'certificate'
    ? t(
        'Cet ordinateur ne reconnaît pas le certificat du serveur. Si c’est bien le serveur de votre équipe, demandez une version de l’app qui le connaît, ou installez le certificat de son autorité (notionix-ca.crt).'
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
  const [again, setAgain] = useState('')
  // An activation link (from Keeper) instead of an address: the person chooses a password.
  const activationLink = parseActivationLink(url) ? url.trim() : null
  // What the server told about a link (only the current link's answer counts).
  const [checked, setChecked] = useState<{
    link: string
    info: ActivationInfo | null
    error: string | null
  } | null>(null)
  const current = checked && checked.link === activationLink ? checked : null
  const activation = current?.info ?? null
  const [busy, setBusy] = useState(false)
  const [submitError, setError] = useState<string | null>(null)
  const error = submitError ?? current?.error ?? null
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

  useEffect(() => {
    if (!activationLink) return
    let cancelled = false
    void server
      .activation(activationLink)
      .catch(() => ({ ok: false as const, error: { kind: 'unreachable' as const } }))
      .then((r) => {
        if (cancelled) return
        setChecked(
          r.ok
            ? { link: activationLink, info: r.info, error: null }
            : { link: activationLink, info: null, error: messageOf(r.error) }
        )
      })
    return () => {
      cancelled = true
    }
  }, [server, activationLink])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (activationLink && !activation) return
    if (activationLink && password !== again) {
      setError(t('Les deux mots de passe diffèrent.'))
      return
    }
    setBusy(true)
    setError(null)
    const result = await (
      activationLink
        ? server.activate(activationLink, password)
        : server.login(url, email, password)
    ).catch(() => ({ ok: false as const, error: { kind: 'unreachable' as const } }))
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
            'Toutes vos pages sont enregistrées sur le serveur, les privées visibles par vous seul ; l’app les garde aussi sur cet ordinateur pour travailler sans réseau.'
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
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
          />
        </label>
        {!status && !activationLink && (
          <p className="server-connect-hint">
            {t('Nouveau compte : collez ici le lien d’activation reçu dans Keeper.')}
          </p>
        )}
        {activationLink ? (
          activation && (
            <>
              <p className="server-connect-hint">
                {t('Bienvenue {name}. Choisissez le mot de passe de', { name: activation.name })}{' '}
                <strong>{activation.email}</strong>.
              </p>
              <label>
                {t('Mot de passe ({n} caractères minimum)', { n: MIN_PASSWORD })}
                <input
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  required
                  minLength={MIN_PASSWORD}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                {t('Mot de passe, à nouveau')}
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </label>
            </>
          )
        ) : (
          <>
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
          </>
        )}
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
          <button
            className="primary"
            type="submit"
            disabled={busy || (activationLink !== null && !activation)}
          >
            {activationLink
              ? busy
                ? t('Activation…')
                : t('Activer mon compte')
              : busy
                ? t('Connexion…')
                : t('Se connecter')}
          </button>
        </div>
      </form>
    </div>
  )
}
