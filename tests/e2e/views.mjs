// E2E for database views (board, calendar, list, gallery) and row templates.
// Run after `npm run build`: node tests/e2e/views.mjs
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-views-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${join(tmp, 'profile')}`] })
const win = await app.firstWindow()
await win.locator('.blank').waitFor()

const today = new Date()
const pad = (n) => String(n).padStart(2, '0')
const day = (d) => `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(d)}`

const ids = await win.evaluate(
  async ({ d3, d5 }) => {
    const api = window.api.databases
    const db = await api.create(null)
    await window.api.pages.update(db.id, { title: 'Projet' })
    const data = await api.get(db.id)
    const schema = {
      ...data.schema,
      properties: [
        ...data.schema.properties,
        {
          id: 'status',
          name: 'Statut',
          type: 'select',
          options: [
            { id: 'todo', name: 'À faire', color: 'gray' },
            { id: 'doing', name: 'En cours', color: 'blue' },
            { id: 'done', name: 'Terminé', color: 'green' }
          ]
        },
        { id: 'due', name: 'Échéance', type: 'date' }
      ]
    }
    await api.updateSchema(db.id, schema)
    await api.createRow(db.id, {
      title: 'Maquettes',
      properties: { status: 'todo', due: { start: d3 } }
    })
    await api.createRow(db.id, {
      title: 'Développement',
      properties: { status: 'doing', due: { start: d3, end: d5 } }
    })
    await api.createRow(db.id, { title: 'Recette', properties: { status: 'done' } })
    const template = await api.createRow(db.id, { title: 'Bug', properties: { status: 'todo' } })
    await api.setTemplate(template.id, true)
    return { db: db.id }
  },
  { d3: day(3), d5: day(5) }
)
await win.evaluate(async (id) => {
  localStorage.setItem('currentId', id)
}, ids.db)
await win.reload()
await win.locator('.db-table').waitFor()
assert.equal(await win.locator('.db-table tbody tr').count(), 3, 'templates stay out of views')

const addView = async (label) => {
  await win.getByRole('button', { name: 'Ajouter une vue' }).click()
  await win.locator('.popover .menu-item', { hasText: label }).click()
}

// board grouped by the select property; dragging a card changes its value
await addView('Board')
const column = (name) =>
  win.locator('.board-column', { has: win.locator('.board-column-head', { hasText: name }) })
await column('À faire').waitFor()
assert.deepEqual(await column('À faire').locator('.board-card .card-title').allInnerTexts(), [
  'Maquettes'
])
// Bring the target column into view first: scrolling the board during the drag would
// put another card under the pointer.
await column('Terminé').scrollIntoViewIfNeeded()
await column('À faire').locator('.board-card').first().dragTo(column('Terminé'))
await column('Terminé').locator('.board-card', { hasText: 'Maquettes' }).waitFor()
assert.equal(await column('À faire').locator('.board-card').count(), 0)
await column('En cours').getByRole('button', { name: '+ Nouveau' }).click()
await win
  .locator('.row-properties')
  .waitFor({ state: 'detached', timeout: 1000 })
  .catch(() => {})
assert.equal(await column('En cours').locator('.board-card').count(), 2)
await win.screenshot({ path: join(tmp, 'board.png') })

// calendar on the date property; ranges cover each day; "+" creates a dated row
await addView('Calendrier')
const dayCell = (d) => win.locator(`.calendar-day[data-date="${day(d)}"]`)
await dayCell(4).waitFor()
assert.deepEqual(await dayCell(3).locator('.calendar-item').allInnerTexts(), [
  'Maquettes',
  'Développement'
])
assert.deepEqual(await dayCell(4).locator('.calendar-item').allInnerTexts(), ['Développement'])
await dayCell(10).hover()
await dayCell(10)
  .getByRole('button', { name: `Ajouter le ${day(10)}` })
  .click()
await dayCell(10).locator('.calendar-item').waitFor()
await win.screenshot({ path: join(tmp, 'calendar.png') })

// list and gallery show every row (6 now: 3 + board + calendar... minus none hidden)
await addView('Liste')
await win.locator('.list-item').first().waitFor()
const listed = await win.locator('.list-item').count()
await addView('Galerie')
await win.locator('.gallery-card:not(.gallery-add)').first().waitFor()
assert.equal(await win.locator('.gallery-card:not(.gallery-add)').count(), listed)
assert.equal(listed, 5)

// new row from the template: values and title copied
await win.getByRole('button', { name: 'Choisir un modèle' }).click()
await win.locator('.popover .menu-item', { hasText: 'Bug' }).click()
await win.waitForTimeout(300)
assert.equal(await win.locator('.gallery-card:not(.gallery-add)').count(), 6)
const values = await win.evaluate(
  async (id) =>
    (await window.api.databases.get(id)).rows
      .filter((r) => r.title === 'Bug')
      .map((r) => [r.isTemplate, r.properties.status]),
  ids.db
)
assert.deepEqual(values.sort(), [
  [false, 'todo'],
  [true, 'todo']
])

// views persist with the schema
const views = await win.evaluate(
  async (id) =>
    (await window.api.databases.get(id)).schema.views.map((v) => [
      v.type,
      v.groupBy ?? null,
      v.dateProperty ?? null
    ]),
  ids.db
)
assert.deepEqual(views, [
  ['table', null, null],
  ['board', 'status', null],
  ['calendar', null, 'due'],
  ['list', null, null],
  ['gallery', null, null]
])
console.log('OK views e2e, screenshots:', tmp)
await app.close()
