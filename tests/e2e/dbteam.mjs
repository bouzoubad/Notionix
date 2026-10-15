// E2E: status, person, files and id properties, sub-items, timeline, chart,
// form and linked views. Run after `npm run build`: node tests/e2e/dbteam.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-dbteam-'))
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.locator('.blank').waitFor()

const pad = (n) => String(n).padStart(2, '0')
const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const ids = await win.evaluate(
  async ({ d0, d3, d5 }) => {
    const api = window.api.databases
    const db = await api.create(null)
    await window.api.pages.update(db.id, { title: 'Projet' })
    const base = (await api.get(db.id)).schema
    const schema = await api.updateSchema(db.id, {
      ...base,
      properties: [
        ...base.properties,
        {
          id: 'st',
          name: 'Statut',
          type: 'status',
          options: [
            { id: 'a', name: 'Pas commencé', color: 'gray', group: 'todo' },
            { id: 'b', name: 'En cours', color: 'blue', group: 'in_progress' },
            { id: 'c', name: 'Terminé', color: 'green', group: 'done' }
          ]
        },
        { id: 'who', name: 'Responsable', type: 'person' },
        { id: 'when', name: 'Période', type: 'date' },
        { id: 'num', name: 'N°', type: 'unique_id', idPrefix: 'TÂCHE' },
        { id: 'by', name: 'Créé par', type: 'created_by' }
      ]
    })
    const rows = []
    for (const [title, st, when] of [
      ['Cadrage', 'c', { start: d0, end: d3 }],
      ['Réalisation', 'b', { start: d3, end: d5 }],
      ['Recette', 'a', null]
    ])
      rows.push(
        (await api.createRow(db.id, { title, properties: { st, who: ['local'], when } })).id
      )
    await api.enableNesting(db.id, 'subItems')
    await api.enableNesting(db.id, 'dependencies')
    const nested = (await api.get(db.id)).schema
    await api.updateRow(rows[2], { [nested.subItems.parentPropertyId]: [rows[1]] })
    await api.updateRow(rows[1], { [nested.dependencies.blockedByPropertyId]: [rows[0]] })
    return { db: db.id, rows, views: schema.views.length }
  },
  { d0: day(0), d3: day(3), d5: day(5) }
)

await win.evaluate((i) => localStorage.setItem('currentId', i), ids.db)
await win.reload()
await win.locator('.db-table').waitFor()

// Table: status tag, person, identifiers, sub-item nested under its parent
await win.locator('.db-table', { hasText: 'TÂCHE-3' }).waitFor()
await win.locator('.db-table .person-chip', { hasText: 'Moi' }).first().waitFor()
await win.locator('.db-table .tag', { hasText: 'En cours' }).waitFor()
const titles = await win.locator('.db-table tbody tr .title-cell').allInnerTexts()
assert.deepEqual(titles, ['Cadrage', 'Réalisation', 'Recette'])
await win.locator('.sub-toggle').first().click()
assert.deepEqual(await win.locator('.db-table tbody tr .title-cell').allInnerTexts(), [
  'Cadrage',
  'Réalisation'
])

const addView = async (label) => {
  await win.getByLabel('Ajouter une vue').click()
  await win.locator('.popover .menu-item', { hasText: label }).click()
}

// Timeline with a dependency arrow
await addView('Chronologie')
await win.locator('.timeline-bar', { hasText: 'Cadrage' }).waitFor()
assert.equal(await win.locator('.timeline-bar').count(), 2)
assert.equal(await win.locator('.timeline-arrows path[d^="M"]').count(), 2) // arrow + marker
const before = await win.locator('.timeline-bar', { hasText: 'Réalisation' }).boundingBox()
await win.mouse.move(before.x + 10, before.y + 10)
await win.mouse.down()
await win.mouse.move(before.x + 10 + 36 * 2, before.y + 10, { steps: 5 })
await win.mouse.up()
await win.waitForFunction(
  async ([db, row, start]) => {
    const data = await window.api.databases.get(db)
    return data.rows.find((r) => r.id === row).properties.when.start === start
  },
  [ids.db, ids.rows[1], day(5)]
)

// Chart grouped by status
await addView('Graphique')
await win.locator('.chart-view select').nth(1).selectOption({ label: 'Statut' })
await win.locator('.chart-svg rect').first().waitFor()
assert.equal(await win.locator('.chart-svg rect').count(), 3)
await win.locator('.chart-view select').first().selectOption('donut')
await win.locator('.donut-legend li', { hasText: 'Terminé' }).waitFor()

// Form adding a row
await addView('Formulaire')
await win.locator('.form-field').first().locator('.cell').click()
await win.keyboard.type('Bilan')
await win.keyboard.press('Enter')
await win.locator('.form-view').getByRole('button', { name: 'Envoyer' }).click()
await win.waitForFunction(
  async (db) => (await window.api.databases.get(db)).rows.some((r) => r.title === 'Bilan'),
  ids.db
)

// Linked view in a page: its own views, the same rows
await win.getByRole('button', { name: '+ Nouvelle page' }).click()
await win.locator('.page-title').fill('Tableau de bord')
await win.locator('.page-title').press('Enter')
await win.keyboard.type('/liee')
await win.locator('.slash-item', { hasText: 'Vue liée' }).first().click()
await win.locator('.dialog input').fill('Projet')
await win.keyboard.press('Enter')
await win.locator('.inline-database .linked-mark').waitFor()
await win.locator('.inline-database .db-table', { hasText: 'Bilan' }).waitFor()
const viewsAfter = (await win.evaluate((db) => window.api.databases.get(db), ids.db)).schema.views
  .length
assert.equal(viewsAfter, ids.views + 3, 'linked view did not add views to the database')

await win.waitForFunction(
  async () => (await window.api.pages.list()).some((p) => p.title === 'Tableau de bord'),
  null,
  { timeout: 5000 }
)
await win.screenshot({ path: join(tmp, 'dbteam.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK dbteam e2e, screenshot: ${join(tmp, 'dbteam.png')}`)
