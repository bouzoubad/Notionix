// E2E: formulas, rollups, manual row order and grouped tables. Run after `npm run build`.
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-dbadv-'))
const launch = () =>
  electron.launch({ args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`] })
let app = await launch()
let win = await app.firstWindow()
await win.locator('.blank').waitFor()

const ids = await win.evaluate(async () => {
  const api = window.api.databases
  const tasks = await api.create(null)
  await window.api.pages.update(tasks.id, { title: 'Tâches' })
  const tBase = (await api.get(tasks.id)).schema
  await api.updateSchema(tasks.id, {
    ...tBase,
    properties: [
      ...tBase.properties,
      { id: 'h', name: 'Heures', type: 'number' },
      {
        id: 'status',
        name: 'Statut',
        type: 'select',
        options: [
          { id: 'todo', name: 'À faire', color: 'gray' },
          { id: 'done', name: 'Terminé', color: 'green' }
        ]
      }
    ]
  })
  const t = []
  for (const [title, h, status] of [
    ['Maquette', 2, 'todo'],
    ['Code', 6, 'todo'],
    ['Tests', 1, 'done']
  ]) {
    t.push((await api.createRow(tasks.id, { title, properties: { h, status } })).id)
  }
  const projects = await api.create(null)
  await window.api.pages.update(projects.id, { title: 'Projets' })
  const pBase = (await api.get(projects.id)).schema
  await api.updateSchema(projects.id, {
    ...pBase,
    properties: [
      ...pBase.properties,
      { id: 'rel', name: 'Tâches', type: 'relation', relationDatabaseId: tasks.id }
    ]
  })
  await api.createRow(projects.id, { title: 'Site', properties: { rel: t } })
  return { tasks: tasks.id, projects: projects.id }
})
const openDb = async (id) => {
  await win.evaluate((i) => localStorage.setItem('currentId', i), id)
  await win.reload()
  await win.locator('.db-table').waitFor()
}
const rows = () => win.locator('.db-table tbody tr[data-row-id]')
const colIndex = async (name) =>
  (await win.locator('.db-table thead th').allInnerTexts()).findIndex((t) => t.includes(name))
const column = async (name) => {
  const i = await colIndex(name)
  return rows()
    .locator(`td:nth-child(${i + 1}) .cell`)
    .allInnerTexts()
}
const addProperty = async (typeLabel, name) => {
  await win.getByRole('button', { name: 'Ajouter une propriété' }).click()
  await win.locator('.popover .menu-item', { hasText: typeLabel }).first().click()
  await win.getByLabel('Nom de la propriété').fill(name)
}

// formula through the UI, then an error
await openDb(ids.tasks)
await addProperty('Formule', 'Coût')
await win.getByLabel('Formule', { exact: true }).fill('prop("Heures") * 50')
await win.locator('.formula-status', { hasText: 'Formule valide' }).waitFor()
await win.getByRole('button', { name: 'Appliquer' }).click()
await win.keyboard.press('Escape')
await win.waitForTimeout(400)
assert.deepEqual(await column('Coût'), ['100', '300', '50'])
await win.locator('.col-head', { hasText: 'Coût' }).click()
await win.getByLabel('Formule', { exact: true }).fill('prop("Heure")')
await win.getByRole('button', { name: 'Appliquer' }).click()
await win.keyboard.press('Escape')
await win.waitForTimeout(400)
assert.match((await column('Coût'))[0], /Propriété inconnue/)
await win.locator('.col-head', { hasText: 'Coût' }).click()
await win.getByLabel('Formule', { exact: true }).fill('prop("Heures") * 50')
await win.getByRole('button', { name: 'Appliquer' }).click()
await win.keyboard.press('Escape')
await win.waitForTimeout(400)

// manual order: drag "Tests" above "Maquette"; it persists
assert.deepEqual(await column('Nom'), ['Maquette', 'Code', 'Tests'])
await rows().nth(2).hover()
await rows()
  .nth(2)
  .locator('.row-drag')
  .dragTo(rows().nth(0), { targetPosition: { x: 40, y: 3 } })
await win.waitForTimeout(500)
assert.deepEqual(await column('Nom'), ['Tests', 'Maquette', 'Code'])

// group the table by status; dragging a row into another group changes its status
await win.locator('.view-tab.active').click()
await win.locator('.popover select').selectOption({ label: 'Statut' })
await win.keyboard.press('Escape')
await win.locator('.group-row').first().waitFor()
assert.deepEqual(
  await win
    .locator('.group-row')
    .allInnerTexts()
    .then((t) => t.map((x) => x.replace(/\s+/g, ''))),
  ['▾SansStatut0+', '▾Àfaire2+', '▾Terminé1+']
)
const code = win.locator('tr[data-row-id]', { hasText: 'Code' })
await code.hover()
await code.locator('.row-drag').dragTo(win.locator('tr[data-row-id]', { hasText: 'Tests' }), {
  targetPosition: { x: 40, y: 25 }
})
await win.waitForTimeout(500)
const status = await win.evaluate(
  async (id) =>
    (await window.api.databases.get(id)).rows.map((r) => [r.title, r.properties.status]),
  ids.tasks
)
assert.deepEqual(Object.fromEntries(status), { Tests: 'done', Maquette: 'todo', Code: 'done' })
await win.screenshot({ path: join(tmp, 'grouped.png') })

// rollup in the projects database: sum of hours, then of the formula
await openDb(ids.projects)
await addProperty('Rollup', 'Total heures')
await win.getByLabel('Relation', { exact: true }).selectOption({ label: 'Tâches' })
await win
  .getByLabel('Propriété agrégée')
  .locator('option', { hasText: 'Heures' })
  .waitFor({ state: 'attached' })
await win.getByLabel('Propriété agrégée').selectOption({ label: 'Heures' })
await win.getByLabel('Calcul').selectOption({ label: 'Somme' })
await win.keyboard.press('Escape')
await win.waitForTimeout(400)
assert.deepEqual(await column('Total heures'), ['9'])
await win.screenshot({ path: join(tmp, 'rollup.png') })
await app.close()

// everything persisted
app = await launch()
win = await app.firstWindow()
await win.locator('.db-table').waitFor()
assert.deepEqual(await column('Total heures'), ['9'])
console.log('OK dbadvanced e2e, screenshots:', tmp)
await app.close()
