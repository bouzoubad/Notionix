import {
  defaultStatusOptions,
  defaultView,
  newId,
  type DatabaseSchema,
  type PropertyDef,
  type ViewDef
} from '../../shared/database'
import type { PageId } from '../../shared/types'
import { locale, t, tx } from '../../shared/i18n'

type Json = Record<string, unknown>

// Small builders of document blocks.
const text = (s: string): Json[] => (s ? [{ type: 'text', text: s }] : [])
const p = (s = ''): Json => ({ type: 'paragraph', content: text(s) })
const h = (level: 1 | 2 | 3, s: string): Json => ({
  type: 'heading',
  attrs: { level },
  content: text(s)
})
const bullets = (items: string[]): Json => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] }))
})
const todos = (items: string[]): Json => ({
  type: 'taskList',
  content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] }))
})
const callout = (icon: string, s: string): Json => ({
  type: 'callout',
  attrs: { icon },
  content: [p(s)]
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
      label: d.toLocaleDateString(locale()),
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
  const { properties, views } = build(t('Nom'))
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
    name: t('Compte rendu de réunion'),
    icon: '📝',
    description: t('Date, participants, ordre du jour, décisions et actions.'),
    create: async (parentId) =>
      (
        await window.api.pages.createWith(parentId, {
          title: t('Réunion'),
          icon: '📝',
          content: doc(
            { type: 'paragraph', content: [{ type: 'text', text: t('Date : ') }, today()] },
            p(t('Participants : ')),
            h(2, t('Ordre du jour')),
            bullets(['', '']),
            h(2, t('Notes')),
            p(),
            h(2, t('Décisions')),
            bullets(['']),
            h(2, t('Actions')),
            todos(['', ''])
          )
        })
      ).id
  },
  {
    id: 'project',
    name: t('Projet'),
    icon: '🚀',
    description: t('Objectif, jalons et une base de tâches avec chronologie et board.'),
    create: async (parentId) => {
      const tasks = await database(
        parentId,
        t('Tâches'),
        '✅',
        () => {
          const status = prop(t('Statut'), 'status', { options: defaultStatusOptions() })
          const who = prop(t('Responsable'), 'person')
          const when = prop(t('Période'), 'date')
          const priority = prop(t('Priorité'), 'select', {
            options: [
              { id: newId(), name: t('Haute'), color: 'red' },
              { id: newId(), name: tx('priorité', 'Moyenne'), color: 'yellow' },
              { id: newId(), name: t('Basse'), color: 'gray' }
            ]
          })
          return {
            properties: [status, who, when, priority],
            views: (all) => [
              view('table', { name: t('Toutes les tâches') }),
              view('board', { name: t('Board'), groupBy: named(all, t('Statut')).id }),
              view('timeline', {
                name: t('Chronologie'),
                dateProperty: named(all, t('Période')).id
              })
            ]
          }
        },
        [
          {
            title: t('Cadrage'),
            values: (all) => ({
              [named(all, t('Statut')).id]: optionId(named(all, t('Statut')), t('Pas commencé'))
            })
          },
          {
            title: t('Réalisation'),
            values: (all) => ({
              [named(all, t('Statut')).id]: optionId(named(all, t('Statut')), t('Pas commencé'))
            })
          },
          {
            title: t('Recette'),
            values: (all) => ({
              [named(all, t('Statut')).id]: optionId(named(all, t('Statut')), t('Pas commencé'))
            })
          }
        ]
      )
      const page = await window.api.pages.createWith(parentId, {
        title: t('Nouveau projet'),
        icon: '🚀',
        content: doc(
          callout('🎯', t('Objectif : décrivez en une phrase ce que le projet doit produire.')),
          h(2, t('Contexte')),
          p(),
          h(2, t('Jalons')),
          todos([t('Lancement'), t('Livraison')]),
          h(2, t('Tâches')),
          inlineDb(tasks)
        )
      })
      await window.api.pages.move(tasks, page.id, 0)
      return page.id
    }
  },
  {
    id: 'wiki',
    name: t('Wiki d’équipe'),
    icon: '📚',
    description: t('Une page d’accueil avec sommaire pour la documentation interne.'),
    create: async (parentId) =>
      (
        await window.api.pages.createWith(parentId, {
          title: t('Wiki'),
          icon: '📚',
          content: doc(
            callout(
              '👋',
              t('Bienvenue : tout ce qu’il faut savoir pour travailler avec l’équipe.')
            ),
            toc(),
            h(2, t('Présentation de l’équipe')),
            p(),
            h(2, t('Outils')),
            bullets([t('Notionix : documentation et suivi'), '']),
            h(2, t('Façons de travailler')),
            p(),
            h(2, t('Contacts')),
            p()
          )
        })
      ).id
  },
  {
    id: 'journal',
    name: t('Journal quotidien'),
    icon: '📔',
    description: t('Priorités du jour, notes et bilan.'),
    create: async (parentId) =>
      (
        await window.api.pages.createWith(parentId, {
          title: t('Journal du {date}', { date: new Date().toLocaleDateString(locale()) }),
          icon: '📔',
          content: doc(
            h(2, t('Priorités')),
            todos(['', '', '']),
            h(2, t('Notes')),
            p(),
            divider(),
            h(3, t('Bilan de la journée')),
            p()
          )
        })
      ).id
  },
  {
    id: 'bugs',
    name: t('Suivi des bugs'),
    icon: '🐞',
    description: t('Base de tickets : statut, priorité, responsable, board par statut.'),
    create: (parentId) =>
      database(parentId, t('Suivi des bugs'), '🐞', () => ({
        properties: [
          prop(t('N°'), 'unique_id', { idPrefix: 'BUG' }),
          prop(t('Statut'), 'status', { options: defaultStatusOptions() }),
          prop(t('Priorité'), 'select', {
            options: [
              { id: newId(), name: t('Bloquant'), color: 'red' },
              { id: newId(), name: t('Majeur'), color: 'orange' },
              { id: newId(), name: t('Mineur'), color: 'gray' }
            ]
          }),
          prop(t('Responsable'), 'person'),
          prop(t('Signalé par'), 'created_by')
        ],
        views: (all) => [
          view('table', { name: t('Tous les bugs') }),
          view('board', { name: t('Par statut'), groupBy: named(all, t('Statut')).id }),
          view('chart', {
            name: t('Répartition'),
            chart: {
              type: 'donut',
              groupBy: named(all, t('Priorité')).id,
              aggregate: 'count',
              valueProperty: null
            }
          })
        ]
      }))
  },
  {
    id: 'reading',
    name: t('Liste de lecture'),
    icon: '📖',
    description: t('Livres et articles : type, avancement, note.'),
    create: (parentId) =>
      database(parentId, t('Liste de lecture'), '📖', () => ({
        properties: [
          prop(t('Type'), 'select', {
            options: [
              { id: newId(), name: t('Livre'), color: 'blue' },
              { id: newId(), name: t('Article'), color: 'green' },
              { id: newId(), name: t('Vidéo'), color: 'purple' }
            ]
          }),
          prop(t('Statut'), 'status', { options: defaultStatusOptions() }),
          prop(t('Auteur'), 'text'),
          prop(tx('évaluation', 'Note'), 'number'),
          prop(t('Lien'), 'url')
        ],
        views: () => [
          view('gallery', { name: t('Galerie') }),
          view('table', { name: t('Tableau') })
        ]
      }))
  }
]
