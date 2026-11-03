import { t } from '../shared/i18n'

/** A client as people read it: « App 1.1.5 », « Navigateur (Safari) ». */
export function clientLabel(client: string): string {
  const [kind, detail = ''] = client.split(':')
  if (kind === 'desktop') return t('App {version}', { version: detail })
  if (kind === 'web') return t('Navigateur ({name})', { name: detail })
  return detail ? t('Autre ({name})', { name: detail }) : t('Autre')
}
