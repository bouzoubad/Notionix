import { useState } from 'react'
import { platform } from '../platform'
import { t } from '../../../shared/i18n'

interface Step {
  icon: string
  title: string
  text: string
}

const STEPS = (web: boolean): Step[] => [
  {
    icon: '👋',
    title: t('Bienvenue dans Notionix'),
    text: t(
      'Des pages pour vos notes, documents et wikis, des bases de données pour vos suivis, le tout dans un seul espace.'
    )
  },
  {
    icon: '📄',
    title: t('Des pages imbriquées'),
    text: t(
      'La barre latérale montre vos pages ; chaque page peut en contenir d’autres. Glissez-les pour les ranger, Cmd/Ctrl-clic pour les ouvrir dans un nouvel onglet.'
    )
  },
  {
    icon: '/',
    title: t('Tout part de « / »'),
    text: t(
      'Sur une ligne vide, « / » ouvre le menu des blocs : titres, listes, tâches, tableaux, images, fichiers, bases de données, équations… « @ » mentionne une personne, une page ou une date.'
    )
  },
  {
    icon: '🗂️',
    title: t('Des bases de données'),
    text: t(
      'Tableau, board, liste, galerie, calendrier, chronologie, graphique, formulaire : la même base, plusieurs vues, avec filtres, tris, formules et modèles.'
    )
  },
  web
    ? {
        icon: '🤝',
        title: t('À plusieurs'),
        text: t(
          'Partagez une page, éditez-la en même temps que les autres, commentez, mentionnez : la boîte de réception vous prévient.'
        )
      }
    : {
        icon: '📦',
        title: t('Vos données, chez vous'),
        text: t(
          'Tout reste sur cet ordinateur. Importez Notion, Word, Evernote ou Confluence ; exportez en Markdown, HTML ou PDF quand vous voulez.'
        )
      },
  {
    icon: '⌨️',
    title: t('Au clavier'),
    text: t(
      'Cmd/Ctrl + P pour chercher, Cmd/Ctrl + N pour une nouvelle page, Cmd/Ctrl + / pour la liste de tous les raccourcis.'
    )
  }
]

/** A short guided tour, step by step. */
export function Tour({ onClose }: { onClose: () => void }): React.JSX.Element {
  const steps = STEPS(platform().kind === 'web')
  const [i, setI] = useState(0)
  const step = steps[i]
  const last = i === steps.length - 1
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'ArrowRight' && !last) setI(i + 1)
          if (e.key === 'ArrowLeft' && i > 0) setI(i - 1)
        }}
      >
        <div className="tour-icon" aria-hidden>
          {step.icon}
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p aria-live="polite">{step.text}</p>
        <div
          className="tour-dots"
          aria-label={t('Étape {n} sur {total}', { n: i + 1, total: steps.length })}
        >
          {steps.map((_, n) => (
            <span key={n} className={n === i ? 'active' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button onClick={onClose}>{t('Passer')}</button>
          {i > 0 && <button onClick={() => setI(i - 1)}>{t('Précédent')}</button>}
          <button className="primary" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? t('C’est parti') : t('Suivant')}
          </button>
        </div>
      </div>
    </div>
  )
}
