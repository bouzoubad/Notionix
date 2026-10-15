import { useState } from 'react'
import { copyText } from '../renderer/src/clipboard'

/** What a person needs to sign in the first time, shown once to the administrator. */
export interface SignInKey {
  name: string
  email: string
  /** Provisional password, to change at first login */
  password?: string
  /** Activation link: the person chooses their own password */
  activation?: { token: string; expiresAt: number }
}

const activationUrl = (token: string): string => `${location.origin}/activate/${token}`

/**
 * The sign-in key of an account, laid out as the fields of a Keeper login
 * record, to share with the person (Keeper one-time share). Shown once: the
 * server keeps only a hash of it.
 */
export function KeeperShare({
  credentials,
  onClose
}: {
  credentials: SignInKey
  onClose: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  const { activation, password } = credentials
  const secret = activation ? activationUrl(activation.token) : (password ?? '')
  const fields: { label: string; value: string }[] = [
    { label: 'Titre', value: `Notionix — ${credentials.name}` },
    { label: 'Identifiant', value: credentials.email },
    activation
      ? { label: 'Lien d’activation', value: secret }
      : { label: 'Mot de passe provisoire', value: secret },
    { label: 'Adresse du site', value: location.origin }
  ]
  const until = activation
    ? new Date(activation.expiresAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long'
      })
    : null
  const note = activation
    ? `Ouvrez le lien d’activation et choisissez votre mot de passe (lien valable jusqu’au ${until}, utilisable une fois).`
    : 'Connectez-vous avec ce mot de passe provisoire : un nouveau vous sera demandé.'
  const copy = async (label: string, value: string): Promise<void> => {
    setCopied((await copyText(value)) ? label : null)
  }
  const all = [...fields.map((f) => `${f.label} : ${f.value}`), `Note : ${note}`].join('\n')

  return (
    <div className="keeper-share">
      <h4>Clé de connexion à partager via Keeper</h4>
      <p className="settings-note">
        Affichée une seule fois. Dans Keeper : <em>Créer &gt; Connexion</em>, collez ces champs,
        puis <em>Partager &gt; Partage à usage unique</em> avec {credentials.name}.
      </p>
      <dl>
        {fields.map((f) => (
          <div key={f.label} className="keeper-field">
            <dt>{f.label}</dt>
            <dd>
              <code>{f.value}</code>
              <button type="button" onClick={() => void copy(f.label, f.value)}>
                {copied === f.label ? 'Copié' : 'Copier'}
              </button>
            </dd>
          </div>
        ))}
        <div className="keeper-field">
          <dt>Note</dt>
          <dd>{note}</dd>
        </div>
      </dl>
      <div className="keeper-actions">
        <button type="button" onClick={() => void copy('all', all)}>
          {copied === 'all' ? 'Tout est copié' : 'Tout copier'}
        </button>
        <button type="button" className="primary" onClick={onClose}>
          C’est partagé
        </button>
      </div>
    </div>
  )
}
