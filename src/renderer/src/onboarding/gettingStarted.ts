import type { PageInit } from '../../../shared/types'

type Node = Record<string, unknown>
const text = (t: string, marks?: string[]): Node => ({
  type: 'text',
  text: t,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {})
})
const p = (...content: Node[]): Node => ({ type: 'paragraph', content })
const h = (level: number, t: string): Node => ({
  type: 'heading',
  attrs: { level },
  content: [text(t)]
})
const todo = (t: string): Node => ({
  type: 'taskItem',
  attrs: { checked: false },
  content: [p(text(t))]
})

/** The "Getting started" page: things to try, checked off as one goes. */
export function gettingStartedPage(web: boolean): PageInit {
  const doc = {
    type: 'doc',
    content: [
      p(text('Quelques gestes pour prendre Notionix en main. Cochez-les au fur et à mesure.')),
      h(2, 'Écrire'),
      {
        type: 'taskList',
        content: [
          todo(
            'Tapez « / » sur une ligne vide pour insérer un titre, une liste, un tableau, une image…'
          ),
          todo('Sélectionnez du texte : un menu propose gras, couleur, lien, commentaire.'),
          todo('Glissez la poignée ⋮⋮ à gauche d’un bloc pour le déplacer.'),
          todo('Tapez « @ » pour mentionner une personne, une page ou une date (avec rappel).'),
          todo('Tapez « [[ » pour lier une autre page.')
        ]
      },
      h(2, 'Organiser'),
      {
        type: 'taskList',
        content: [
          todo(
            'Créez une sous-page avec « /page » ; elle apparaît sous celle-ci dans la barre latérale.'
          ),
          todo(
            'Créez une base de données (tableau, board, calendrier…) avec « + Nouvelle base de données ».'
          ),
          todo('Ajoutez une page aux favoris depuis son menu « ⋯ ».'),
          todo('Retrouvez tout avec la recherche (Cmd/Ctrl + P).')
        ]
      },
      h(2, web ? 'Travailler à plusieurs' : 'Importer et exporter'),
      {
        type: 'taskList',
        content: web
          ? [
              todo('Partagez une page avec une personne ou un groupe (« Partager », en haut).'),
              todo('Commentez une sélection, et suivez les réponses dans la boîte de réception.'),
              todo('Signalez un bug ou une idée avec « Feedback » en bas de la barre latérale.')
            ]
          : [
              todo(
                'Importez un export de Notion, un document Word ou des notes Evernote (« Importer / Exporter »).'
              ),
              todo('Exportez une page en Markdown, HTML ou PDF depuis son menu « ⋯ ».')
            ]
      },
      p(text('Tous les raccourcis : Cmd/Ctrl + /', ['bold']))
    ]
  }
  return { title: 'Bien démarrer', icon: '👋', content: JSON.stringify(doc) }
}
