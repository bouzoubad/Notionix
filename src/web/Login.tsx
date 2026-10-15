import { useState } from 'react'
import type { SessionUser } from '../shared/collab'
import { Logo } from '../renderer/src/components/Logo'
import { json } from './http'
import { LANGUAGES, language, setLanguage, t, type Language } from '../shared/i18n'

export function Login({
  onSignedIn
}: {
  onSignedIn: (user: SessionUser) => void
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user } = await json<{ user: SessionUser }>('/api/login', {
        json: { email, password }
      })
      onSignedIn(user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <Logo variant="wordmark" className="login-logo" />
        <label>
          {t('E-mail')}
          <input
            type="email"
            autoComplete="username"
            autoFocus
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
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t('Connexion…') : t('Se connecter')}
        </button>
        {location.protocol === 'http:' &&
          !['localhost', '127.0.0.1'].includes(location.hostname) && (
            <p className="login-warning">
              {t('Connexion non chiffrée (HTTP) : réservée aux essais sur le réseau local.')}
            </p>
          )}
        <select
          className="login-language"
          aria-label={t('Langue')}
          value={language()}
          onChange={(e) => {
            setLanguage(e.target.value as Language)
            location.reload()
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </form>
    </div>
  )
}
