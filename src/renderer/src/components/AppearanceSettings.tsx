import { useEffect, useState } from 'react'
import {
  APPEARANCE_KEYS,
  APPEARANCE_LABELS,
  THEMES,
  DEFAULT_APPEARANCE,
  type Appearance,
  type AppearanceKey,
  type ColorMode
} from '../../../shared/appearance'
import { t } from '../../../shared/i18n'
import { saveAppearance, shownColor, storedAppearance } from '../appearance'
import { platform } from '../platform'
import { useStore } from '../store'

/** The mode shown now: the forced one, or the system's. */
const shownMode = (theme: 'system' | 'light' | 'dark'): ColorMode =>
  theme === 'system'
    ? matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : theme

/**
 * Apparence: light or dark mode, a theme (colours for both modes, like a
 * code editor's), and one's own colour for any element of the mode shown.
 * Kept in the account when there is one (it follows the person), else on
 * this computer.
 */
export function AppearanceSettings(): React.JSX.Element {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance)
  const [error, setError] = useState<string | null>(null)
  const mode = shownMode(theme)
  // The colours shown change with the mode and the theme: read again after each change.
  const [shown, setShown] = useState<Record<AppearanceKey, string> | null>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setShown(
        Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, shownColor(k)])) as Record<
          AppearanceKey,
          string
        >
      )
    )
    return () => cancelAnimationFrame(frame)
  }, [appearance, mode])

  const change = (next: Appearance): void => {
    setAppearance(next)
    setError(null)
    saveAppearance(next).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  const setColor = (key: AppearanceKey, color: string | null): void => {
    const palette = { ...appearance.custom[mode] }
    if (color === null) delete palette[key]
    else palette[key] = color
    change({ ...appearance, custom: { ...appearance.custom, [mode]: palette } })
  }
  const custom = appearance.custom[mode]

  return (
    <div className="appearance-settings">
      <section>
        <h4>{t('Mode')}</h4>
        <div className="appearance-modes" role="radiogroup" aria-label={t('Mode')}>
          {(
            [
              ['system', t('Système')],
              ['light', t('Clair')],
              ['dark', t('Sombre')]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={theme === id}
              className={theme === id ? 'active' : ''}
              onClick={() => setTheme(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4>{t('Thème')}</h4>
        <div className="appearance-themes">
          {THEMES.map((th) => {
            const colors = { ...th[mode] }
            return (
              <button
                key={th.id}
                className={`appearance-theme${appearance.theme === th.id ? ' active' : ''}`}
                aria-pressed={appearance.theme === th.id}
                onClick={() => change({ ...appearance, theme: th.id })}
              >
                <span
                  className="appearance-swatch"
                  style={{
                    background: colors.bg ?? 'var(--bg)',
                    color: colors.text ?? 'var(--text)'
                  }}
                  aria-hidden
                >
                  <span>Aa</span>
                  <code
                    style={{
                      color:
                        colors['code-text'] === 'inherit'
                          ? (colors.text ?? 'var(--text)')
                          : (colors['code-text'] ?? (mode === 'dark' ? '#ff7369' : '#eb5757'))
                    }}
                  >
                    {'{ }'}
                  </code>
                  <i style={{ background: colors.accent ?? 'var(--accent)' }} />
                </span>
                {t(th.name)}
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h4>
          {mode === 'dark'
            ? t('Couleurs du mode sombre (affiché)')
            : t('Couleurs du mode clair (affiché)')}
        </h4>
        <p className="settings-note">
          {t(
            'Chaque couleur choisie remplace celle du thème, pour ce mode. Passez à l’autre mode ci-dessus pour régler ses couleurs.'
          )}
        </p>
        <div className="appearance-colors">
          {APPEARANCE_KEYS.map((key) => (
            <label key={key} className="appearance-color">
              <span>{t(APPEARANCE_LABELS[key])}</span>
              <input
                type="color"
                value={custom[key] ?? shown?.[key] ?? '#000000'}
                onChange={(e) => setColor(key, e.target.value)}
              />
              {custom[key] ? (
                <button type="button" onClick={() => setColor(key, null)}>
                  {t('Par défaut')}
                </button>
              ) : (
                <span className="appearance-default">{t('du thème')}</span>
              )}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h4>{t('Aperçu')}</h4>
        <div className="editor appearance-preview">
          <h3>{t('Un titre')}</h3>
          <p>
            {t('Du texte, un')} <a>{t('lien')}</a> {t('et du')} <code>code</code>{' '}
            {t('dans la phrase.')}
          </p>
          <blockquote>{t('Une citation.')}</blockquote>
          <pre>
            <code>{'const notionix = true'}</code>
          </pre>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      <div className="appearance-actions">
        <button type="button" onClick={() => change(DEFAULT_APPEARANCE)}>
          {t('Tout réinitialiser')}
        </button>
        <span className="settings-note">
          {platform().appearance
            ? t('Enregistré dans votre compte : vos autres appareils prennent ces couleurs.')
            : t('Enregistré sur cet ordinateur.')}
        </span>
      </div>
    </div>
  )
}
