import type { PageInit } from '../../../shared/types'
import { t } from '../../../shared/i18n'

type Node = Record<string, unknown>
const text = (s: string, marks?: string[]): Node => ({
  type: 'text',
  text: s,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {})
})
const p = (...content: Node[]): Node => ({ type: 'paragraph', content })
const h = (level: number, s: string): Node => ({
  type: 'heading',
  attrs: { level },
  content: [text(s)]
})
const todo = (s: string): Node => ({
  type: 'taskItem',
  attrs: { checked: false },
  content: [p(text(s))]
})

/** The "Getting started" page: things to try, checked off as one goes. */
export function gettingStartedPage(web: boolean): PageInit {
  const doc = {
    type: 'doc',
    content: [
      p(text(t('Quelques gestes pour prendre Notionix en main. Cochez-les au fur et à mesure.'))),
      h(2, t('Écrire')),
      {
        type: 'taskList',
        content: [
          todo(
            t(
              'Tapez « / » sur une ligne vide pour insérer un titre, une liste, un tableau, une image…'
            )
          ),
          todo(t('Sélectionnez du texte : un menu propose gras, couleur, lien, commentaire.')),
          todo(t('Glissez la poignée ⋮⋮ à gauche d’un bloc pour le déplacer.')),
          todo(t('Tapez « @ » pour mentionner une personne, une page ou une date (avec rappel).')),
          todo(t('Tapez « [[ » pour lier une autre page.'))
        ]
      },
      h(2, t('Organiser')),
      {
        type: 'taskList',
        content: [
          todo(
            t(
              'Créez une sous-page avec « /page » ; elle apparaît sous celle-ci dans la barre latérale.'
            )
          ),
          todo(
            t(
              'Créez une base de données (tableau, board, calendrier…) avec « + Nouvelle base de données ».'
            )
          ),
          todo(t('Ajoutez une page aux favoris depuis son menu « ⋯ ».')),
          todo(t('Retrouvez tout avec la recherche (Cmd/Ctrl + P).'))
        ]
      },
      h(2, web ? t('Travailler à plusieurs') : t('Importer et exporter')),
      {
        type: 'taskList',
        content: web
          ? [
              todo(t('Partagez une page avec une personne ou un groupe (« Partager », en haut).')),
              todo(
                t('Commentez une sélection, et suivez les réponses dans la boîte de réception.')
              ),
              todo(t('Signalez un bug ou une idée avec « Feedback » en bas de la barre latérale.'))
            ]
          : [
              todo(
                t(
                  'Importez un export de Notion, un document Word ou des notes Evernote (« Importer / Exporter »).'
                )
              ),
              todo(t('Exportez une page en Markdown, HTML ou PDF depuis son menu « ⋯ ».'))
            ]
      },
      p(text(t('Tous les raccourcis : Cmd/Ctrl + /'), ['bold']))
    ]
  }
  return { title: t('Bien démarrer'), icon: '👋', content: JSON.stringify(doc) }
}
