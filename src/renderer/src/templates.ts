import {
  defaultStatusOptions,
  defaultView,
  newId,
  type DatabaseSchema,
  type PropertyDef,
  type ViewDef
} from '../../shared/database'
import type { PageId } from '../../shared/types'

type Json = Record<string, unknown>

// Small builders of document blocks.
const text = (t: string): Json[] => (t ? [{ type: 'text', text: t }] : [])
const p = (t = ''): Json => ({ type: 'paragraph', content: text(t) })
const h = (level: 1 | 2 | 3, t: string): Json => ({
  type: 'heading',
  attrs: { level },
  content: text(t)
})
const bullets = (items: string[]): Json => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] }))
})
const todos = (items: string[]): Json => ({
  type: 'taskList',
  content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] }))
})
const callout = (icon: string, t: string): Json => ({
  type: 'callout',
  attrs: { icon },
  content: [p(t)]
})
const toc = (): Json => ({ type: 'tableOfContents' })
const divider = (): Json => ({ type: 'horizontalRule' })
const today = (): Json => {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    type: 'mention',
    attrs: {
      kind: 'date',
      id: newId(),
      label: d.toLocaleDateString('fr-FR'),
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      reminder: false
    }
  }
}
const doc = (...blocks: Json[]): string => JSON.stringify({ type: 'doc', content: blocks })
const inlineDb = (databaseId: string): Json => ({ type: 'databaseView', attrs: { databaseId } })

export interface Template {
  id: string
  name: string
  icon: string
  description: string
  /** Creates the page (and its databases) under `parentId`; returns the page to open */
  create: (parentId: PageId | null) => Promise<PageId>
}

const prop = (
  name: string,
  type: PropertyDef['type'],
  extra: Partial<PropertyDef> = {}
): PropertyDef => ({
  id: newId(),
  name,
  type,
  ...extra
})
const view = (type: ViewDef['type'], extra: Partial<ViewDef> = {}): ViewDef => ({
  ...defaultView(type),
  ...extra
})

/** A database with these properties and views, its rows created from `rows`. */
async function database(
  parentId: PageId | null,
  title: string,
  icon: string,
  build: (titleName: string) => {
    properties: PropertyDef[]
    views: (props: PropertyDef[]) => ViewDef[]
  },
  rows: { title: string; values: (props: PropertyDef[]) => Record<string, unknown> }[] = []
): Promise<PageId> {
  const db = await window.api.databases.create(parentId)
  await window.api.pages.update(db.id, { title, icon })
  const base = (await window.api.databases.get(db.id))!.schema
  const { properties, views } = build('Nom')
  const all = [...base.properties, ...properties]
  const schema: DatabaseSchema = { properties: all, views: views(all) }
  await window.api.databases.updateSchema(db.id, schema)
  for (const r of rows)
    await window.api.databases.createRow(db.id, {
      title: r.title,
      properties: r.values(all) as never
    })
  return db.id
}

const named = (props: PropertyDef[], name: string): PropertyDef =>
  props.find((x) => x.name === name)!
const optionId = (prop: PropertyDef, name: string): string =>
  prop.options!.find((o) => o.name === name)!.id

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: 'meeting',
    name: 'Compte rendu de réunion',
    icon: '📝',
    description: 'Date, participants, ordre du jour, décisions et actions.',
    create: async (parentId) =>
      (
        await window.api.pages.createWith(parentId, {
          title: 'Réunion',
          icon: '📝',
          content: doc(
            { type: 'paragraph', content: [{ type: 'text', text: 'Date : ' }, today()] },
            p('Participants : '),
            h(2, 'Ordre du jour'),
            bullets(['', '']),
            h(2, 'Notes'),
            p(),
            h(2, 'Décisions'),
            bullets(['']),
            h(2, 'Actions'),
            todos(['', ''])
          )
        })
      ).id
  },
  {
    id: 'project',
    name: 'Projet',
    icon: '🚀',
    description: 'Objectif, jalons et une base de tâches avec chronologie et board.',
    create: async (parentId) => {
      const tasks = await database(
        parentId,
        'Tâches',
        '✅',
        () => {
          const status = prop('Statut', 'status', { options: defaultStatusOptions() })
          const who = prop('Responsable', 'person')
          const when = prop('Période', 'date')
          const priority = prop('Priorité', 'select', {
            options: [
              { id: newId(), name: 'Haute', color: 'red' },
              { id: newId(), name: 'Moyenne', color: 'yellow' },
              { id: newId(), name: 'Basse', color: 'gray' }
            ]
          })
          return {
            properties: [status, who, when, priority],
            views: (all) => [
              view('table', { name: 'Toutes les tâches' }),
              view('board', { name: 'Board', groupBy: named(all, 'Statut').id }),
              view('timeline', { name: 'Chronologie', dateProperty: named(all, 'Période').id })
            ]
          }
        },
        [
          {
            title: 'Cadrage',
            values: (all) => ({
              [named(all, 'Statut').id]: optionId(named(all, 'Statut'), 'Pas commencé')
            })
          },
          {
            title: 'Réalisation',
            values: (all) => ({
              [named(all, 'Statut').id]: optionId(named(all, 'Statut'), 'Pas commencé')
            })
          },
          {
            title: 'Recette',
            values: (all) => ({
              [named(all, 'Statut').id]: optionId(named(all, 'Statut'), 'Pas commencé')
            })
          }
        ]
      )
      const page = await window.api.pages.createWith(parentId, {
        title: 'Nouveau projet',
        icon: '🚀',
        content: doc(
          callout('🎯', 'Objectif : décrivez en une phrase ce que le projet doit produire.'),
          h(2, 'Contexte'),
          p(),
          h(2, 'Jalons'),
          todos(['Lancement', 'Livraison']),
          h(2, 'Tâches'),
          inlineDb(tasks)
        )
      })
      await window.api.pages.move(tasks, page.id, 0)
      return page.id
    }
  },
  {
    id: 'wiki',
    name: 'Wiki d’équipe',
    icon: '📚',
    description: 'Une page d’accueil avec sommaire pour la documentation interne.',
    create: async (parentId) =>
      (
        await window.api.pages.createWith(parentId, {
          title: 'Wiki',
          icon: '📚',
          content: doc(
            callout('👋', 'Bienvenue : tout ce qu’il faut savoir pour travailler avec l’équipe.'),
            toc(),
            h(2, 'Présentation de l’équipe'),
            p(),
            h(2, 'Outils'),
            bullets(['Notionix : documentation et suivi', '']),
            h(2, 'Façons de travailler'),
            p(),
            h(2, 'Contacts'),
            p()
          )
        })
      ).id
  },
  {
    id: 'journal',
    name: 'Journal quotidien',
    icon: '📔',
    description: 'Priorités du jour, notes et bilan.',
    create: async (parentId) =>
      (
        await window.api.pages.createWith(parentId, {
          title: `Journal du ${new Date().toLocaleDateString('fr-FR')}`,
          icon: '📔',
          content: doc(
            h(2, 'Priorités'),
            todos(['', '', '']),
            h(2, 'Notes'),
            p(),
            divider(),
            h(3, 'Bilan de la journée'),
            p()
          )
        })
      ).id
  },
  {
    id: 'bugs',
    name: 'Suivi des bugs',
    icon: '🐞',
    description: 'Base de tickets : statut, priorité, responsable, board par statut.',
    create: (parentId) =>
      database(parentId, 'Suivi des bugs', '🐞', () => ({
        properties: [
          prop('N°', 'unique_id', { idPrefix: 'BUG' }),
          prop('Statut', 'status', { options: defaultStatusOptions() }),
          prop('Priorité', 'select', {
            options: [
              { id: newId(), name: 'Bloquant', color: 'red' },
              { id: newId(), name: 'Majeur', color: 'orange' },
              { id: newId(), name: 'Mineur', color: 'gray' }
            ]
          }),
          prop('Responsable', 'person'),
          prop('Signalé par', 'created_by')
        ],
        views: (all) => [
          view('table', { name: 'Tous les bugs' }),
          view('board', { name: 'Par statut', groupBy: named(all, 'Statut').id }),
          view('chart', {
            name: 'Répartition',
            chart: {
              type: 'donut',
              groupBy: named(all, 'Priorité').id,
              aggregate: 'count',
              valueProperty: null
            }
          })
        ]
      }))
  },
  {
    id: 'reading',
    name: 'Liste de lecture',
    icon: '📖',
    description: 'Livres et articles : type, avancement, note.',
    create: (parentId) =>
      database(parentId, 'Liste de lecture', '📖', () => ({
        properties: [
          prop('Type', 'select', {
            options: [
              { id: newId(), name: 'Livre', color: 'blue' },
              { id: newId(), name: 'Article', color: 'green' },
              { id: newId(), name: 'Vidéo', color: 'purple' }
            ]
          }),
          prop('Statut', 'status', { options: defaultStatusOptions() }),
          prop('Auteur', 'text'),
          prop('Note', 'number'),
          prop('Lien', 'url')
        ],
        views: () => [view('gallery', { name: 'Galerie' }), view('table', { name: 'Tableau' })]
      }))
  }
]
