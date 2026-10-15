import { useState } from 'react'
import { platform } from '../platform'

interface Step {
  icon: string
  title: string
  text: string
}

const STEPS = (web: boolean): Step[] => [
  {
    icon: '👋',
    title: 'Bienvenue dans Notionix',
    text: 'Des pages pour vos notes, documents et wikis, des bases de données pour vos suivis, le tout dans un seul espace.'
  },
  {
    icon: '📄',
    title: 'Des pages imbriquées',
    text: 'La barre latérale montre vos pages ; chaque page peut en contenir d’autres. Glissez-les pour les ranger, Cmd/Ctrl-clic pour les ouvrir dans un nouvel onglet.'
  },
  {
    icon: '/',
    title: 'Tout part de « / »',
    text: 'Sur une ligne vide, « / » ouvre le menu des blocs : titres, listes, tâches, tableaux, images, fichiers, bases de données, équations… « @ » mentionne une personne, une page ou une date.'
  },
  {
    icon: '🗂️',
    title: 'Des bases de données',
    text: 'Tableau, board, liste, galerie, calendrier, chronologie, graphique, formulaire : la même base, plusieurs vues, avec filtres, tris, formules et modèles.'
  },
  web
    ? {
        icon: '🤝',
        title: 'À plusieurs',
        text: 'Partagez une page, éditez-la en même temps que les autres, commentez, mentionnez : la boîte de réception vous prévient.'
      }
    : {
        icon: '📦',
        title: 'Vos données, chez vous',
        text: 'Tout reste sur cet ordinateur. Importez Notion, Word, Evernote ou Confluence ; exportez en Markdown, HTML ou PDF quand vous voulez.'
      },
  {
    icon: '⌨️',
    title: 'Au clavier',
    text: 'Cmd/Ctrl + P pour chercher, Cmd/Ctrl + N pour une nouvelle page, Cmd/Ctrl + / pour la liste de tous les raccourcis.'
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
        <div className="tour-dots" aria-label={`Étape ${i + 1} sur ${steps.length}`}>
          {steps.map((_, n) => (
            <span key={n} className={n === i ? 'active' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button onClick={onClose}>Passer</button>
          {i > 0 && <button onClick={() => setI(i - 1)}>Précédent</button>}
          <button className="primary" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? 'C’est parti' : 'Suivant'}
          </button>
        </div>
      </div>
    </div>
  )
}
