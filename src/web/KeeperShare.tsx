import { useState } from 'react'
import { copyText } from '../renderer/src/clipboard'
import { locale, t, tx } from '../shared/i18n'
import { serverOrigin } from '../renderer/src/platform'
import { useMacDownload } from './downloads'

/** What a person needs to sign in the first time, shown once to the administrator. */
export interface SignInKey {
  name: string
  email: string
  /** Provisional password, to change at first login */
  password?: string
  /** Activation link: the person chooses their own password */
  activation?: { token: string; expiresAt: number }
}

const activationUrl = (token: string): string => `${serverOrigin()}/activate/${token}`

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
  const download = useMacDownload()
  const { activation, password } = credentials
  const secret = activation ? activationUrl(activation.token) : (password ?? '')
  const fields: { label: string; value: string }[] = [
    { label: t('Titre'), value: `Notionix — ${credentials.name}` },
    { label: tx('connexion', 'Identifiant'), value: credentials.email },
    activation
      ? { label: t('Lien d’activation'), value: secret }
      : { label: t('Mot de passe provisoire'), value: secret },
    { label: t('Adresse du site'), value: serverOrigin() },
    ...(download ? [{ label: t('App de bureau (Mac)'), value: download.shared }] : [])
  ]
  const until = activation
    ? new Date(activation.expiresAt).toLocaleDateString(locale(), {
        day: 'numeric',
        month: 'long'
      })
    : null
  const first = activation
    ? t(
        'Ouvrez le lien d’activation et choisissez votre mot de passe (lien valable jusqu’au {until}, utilisable une fois).',
        { until: until ?? '' }
      )
    : t('Connectez-vous avec ce mot de passe provisoire : un nouveau vous sera demandé.')
  // With the desktop app: everything happens in it, no certificate to install.
  const note = !download
    ? first
    : activation
      ? t(
          'Installez l’app de bureau (lien ci-dessus), puis dans l’app « Se connecter à un serveur » : collez le lien d’activation et choisissez votre mot de passe (lien valable jusqu’au {until}, utilisable une fois).',
          { until: until ?? '' }
        )
      : t(
          'Installez l’app de bureau (lien ci-dessus), puis dans l’app « Se connecter à un serveur » : adresse du site, identifiant et ce mot de passe provisoire (un nouveau vous sera demandé).'
        )
  // Not notarized by Apple yet: macOS asks once to confirm.
  const gatekeeper = download
    ? t(
        'Si macOS refuse d’ouvrir l’app : Réglages Système > Confidentialité et sécurité > « Ouvrir quand même ».'
      )
    : null
  const copy = async (label: string, value: string): Promise<void> => {
    setCopied((await copyText(value)) ? label : null)
  }
  const all = [
    ...fields.map((f) => t('{label} : {value}', { label: f.label, value: f.value })),
    t('Note : {note}', { note: gatekeeper ? `${note} ${gatekeeper}` : note })
  ].join('\n')

  return (
    <div className="keeper-share">
      <h4>{t('Clé de connexion à partager via Keeper')}</h4>
      <p className="settings-note">
        {t('Affichée une seule fois. Dans Keeper :')} <em>{t('Créer > Connexion')}</em>
        {t(', collez ces champs, puis')} <em>{t('Partager > Partage à usage unique')}</em>{' '}
        {t('avec {name}.', { name: credentials.name })}
      </p>
      <dl>
        {fields.map((f) => (
          <div key={f.label} className="keeper-field">
            <dt>{f.label}</dt>
            <dd>
              <code>{f.value}</code>
              <button type="button" onClick={() => void copy(f.label, f.value)}>
                {copied === f.label ? t('Copié') : t('Copier')}
              </button>
            </dd>
          </div>
        ))}
        <div className="keeper-field">
          <dt>{t('Note')}</dt>
          <dd>
            {note}
            {gatekeeper && (
              <>
                <br />
                {gatekeeper}
              </>
            )}
          </dd>
        </div>
      </dl>
      <div className="keeper-actions">
        <button type="button" onClick={() => void copy('all', all)}>
          {copied === 'all' ? t('Tout est copié') : t('Tout copier')}
        </button>
        <button type="button" className="primary" onClick={onClose}>
          {t('C’est partagé')}
        </button>
      </div>
    </div>
  )
}
