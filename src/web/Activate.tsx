import { useEffect, useState } from 'react'
import { Logo } from '../renderer/src/components/Logo'
import { json } from './http'

const MIN_PASSWORD = 10

/** The activation link of a new account: the person chooses their password, then enters. */
export function Activate({ token }: { token: string }): React.JSX.Element {
  const [who, setWho] = useState<{ email: string; name: string } | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const path = `/api/activate/${encodeURIComponent(token)}`

  useEffect(() => {
    let cancelled = false
    json<{ email: string; name: string }>(path)
      .then((w) => !cancelled && setWho(w))
      .catch((e) => !cancelled && setInvalid(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [path])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (password !== again) return setError('Les deux mots de passe diffèrent.')
    setBusy(true)
    setError(null)
    try {
      await json(path, { json: { password } })
      // Signed in: the app opens, and the link no longer works.
      location.replace('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <Logo variant="wordmark" className="login-logo" />
        {invalid ? (
          <p className="error">{invalid} Demandez un nouveau lien à un administrateur.</p>
        ) : !who ? (
          <p>Chargement…</p>
        ) : (
          <>
            <p>
              Bienvenue {who.name}. Choisissez le mot de passe de <strong>{who.email}</strong>.
            </p>
            <label>
              Mot de passe ({MIN_PASSWORD} caractères minimum)
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
              Mot de passe, à nouveau
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
              {busy ? 'Activation…' : 'Activer mon compte'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
