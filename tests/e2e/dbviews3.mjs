// E2E: formulas 2.0 over related pages, more chart types, locked databases
// and recurring templates. Run after `npm run build`: node tests/e2e/dbviews3.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-dbviews3-'))
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.locator('.blank').waitFor()

const { projects } = await win.evaluate(async () => {
  const api = window.api.databases
  const tasks = await api.create(null)
  await window.api.pages.update(tasks.id, { title: 'Tâches' })
  const t = (await api.get(tasks.id)).schema
  await api.updateSchema(tasks.id, {
    ...t,
    properties: [
      ...t.properties,
      { id: 'done', name: 'Fait', type: 'checkbox' },
      { id: 'h', name: 'Heures', type: 'number' },
      {
        id: 'team',
        name: 'Équipe',
        type: 'select',
        options: [
          { id: 'a', name: 'Alpha', color: 'blue' },
          { id: 'b', name: 'Bêta', color: 'green' }
        ]
      }
    ]
  })
  const rows = []
  for (const [title, done, h, team] of [
    ['Maquette', true, 3, 'a'],
    ['Code', false, 8, 'a'],
    ['Tests', false, 2, 'b']
  ])
    rows.push(await api.createRow(tasks.id, { title, properties: { done, h, team } }))
  const projects = await api.create(null)
  await window.api.pages.update(projects.id, { title: 'Projets' })
  const p = (await api.get(projects.id)).schema
  await api.updateSchema(projects.id, {
    ...p,
    properties: [
      ...p.properties,
      { id: 'rel', name: 'Tâches', type: 'relation', relationDatabaseId: tasks.id },
      {
        id: 'left',
        name: 'Reste',
        type: 'formula',
        formula: 'prop("Tâches").filter(not current.prop("Fait")).map(current.prop("Heures")).sum()'
      }
    ]
  })
  await api.createRow(projects.id, {
    title: 'Refonte',
    properties: { rel: rows.map((r) => r.id) }
  })
  return { tasks: tasks.id, projects: projects.id }
})

await win.reload()
await win.locator('.sidebar').waitFor()

// Formula over the related pages: 8 + 2 hours left
await win.locator('.sidebar .row', { hasText: 'Projets' }).click()
await win.locator('.db-table td', { hasText: /^10$/ }).waitFor()

// Charts of the tasks: stacked bars, pie, a single number
await win.locator('.sidebar .row', { hasText: 'Tâches' }).click()
await win.locator('.db-table').waitFor()
await win.getByLabel('Ajouter une vue').click()
await win.locator('.popover .menu-item', { hasText: 'Graphique' }).click()
await win.getByLabel('Type de graphique').selectOption('pie')
await win
  .locator('.chart-settings label', { hasText: 'Grouper par' })
  .locator('select')
  .selectOption({ label: 'Équipe' })
await win.locator('.donut-legend li', { hasText: 'Alpha' }).waitFor()
await win.getByLabel('Type de graphique').selectOption('number')
await win
  .locator('.chart-settings label', { hasText: 'Valeur' })
  .locator('select')
  .selectOption({ label: 'Somme de Heures' })
await win.locator('.chart-number strong', { hasText: '13' }).waitFor()
await win.getByLabel('Type de graphique').selectOption('stacked')
await win
  .locator('.chart-settings label', { hasText: 'Grouper par' })
  .locator('select')
  .selectOption({ label: 'Équipe' })
await win
  .locator('.chart-settings label', { hasText: 'Empiler par' })
  .locator('select')
  .selectOption({ label: 'Fait' })
await win.locator('.chart-legend li', { hasText: 'Oui' }).waitFor()

// Lock: views and properties no longer change, rows still do
await win.getByTitle('Réglages de la base').click()
await win.locator('.popover .menu-row', { hasText: 'Verrouiller' }).locator('input').check()
await win.keyboard.press('Escape')
await win.locator('.db-locked-badge').waitFor()
assert.equal(await win.getByLabel('Ajouter une vue').isVisible(), false)
assert.equal(await win.getByRole('button', { name: /^Filtrer/ }).isDisabled(), true)
await win.locator('.view-tab', { hasText: 'Tableau' }).click()
assert.equal(await win.getByLabel('Ajouter une propriété').isVisible(), false)
const refused = await win.evaluate(
  async (id) => {
    const s = (await window.api.databases.get(id)).schema
    try {
      await window.api.databases.updateSchema(id, { ...s, properties: s.properties.slice(0, 2) })
      return 'accepted'
    } catch (e) {
      return String(e)
    }
  },
  await win.evaluate(() => location.hash.slice(7))
)
assert.match(refused, /verrouillée/)
await win.getByTitle('Réglages de la base').click()
await win.locator('.popover .menu-row', { hasText: 'Verrouiller' }).locator('input').uncheck()
await win.keyboard.press('Escape')
await win.getByLabel('Ajouter une vue').waitFor()

// A template repeated every Monday and Thursday at 9:00
const tasksId = await win.evaluate(() => location.hash.slice(7))
await win.evaluate(async (id) => {
  const row = await window.api.databases.createRow(id, { title: 'Point d’équipe' })
  await window.api.databases.setTemplate(row.id, true)
}, tasksId)
await win.reload()
await win.locator('.db-table').waitFor()
await win.getByLabel('Choisir un modèle').click()
await win.getByLabel('Répéter Point d’équipe').click()
const days = win.locator('.recurrence-days button')
for (let i = 0; i < 7; i++)
  if ((await days.nth(i).getAttribute('aria-pressed')) === 'true') await days.nth(i).click()
await days.nth(0).click()
await days.nth(3).click()
await win.locator('.recurrence-editor input[type="time"]').fill('09:00')
await win.locator('.recurrence-editor').getByRole('button', { name: 'Répéter' }).click()
await win.locator('.notice', { hasText: 'prochaine création' }).waitFor()
const schedule = await win.evaluate((id) => window.api.databases.recurrences(id), tasksId)
assert.deepEqual(schedule[0].rule.weekdays, [1, 4])
assert.equal(schedule[0].rule.time, '09:00')
const next = new Date(schedule[0].nextAt)
assert.ok([1, 4].includes(next.getDay()) && next.getHours() === 9, String(next))

await win.screenshot({ path: join(tmp, 'dbviews3.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK dbviews3 e2e, screenshot: ${join(tmp, 'dbviews3.png')}`)
