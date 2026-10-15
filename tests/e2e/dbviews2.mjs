// E2E: column calculations and widths, frozen title, sub-groups, filter
// groups with relative dates, calendar drag and CSV import.
// Run after `npm run build`: node tests/e2e/dbviews2.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-dbviews2-'))
const csv = join(tmp, 'achats.csv')
writeFileSync(csv, 'Nom,Prix,Catégorie\nClavier,40,Matériel\nLicence,120,Logiciel\n')
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.locator('.blank').waitFor()

const pad = (n) => String(n).padStart(2, '0')
const today = new Date()
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const id = await win.evaluate(async (day) => {
  const api = window.api.databases
  const db = await api.create(null)
  await window.api.pages.update(db.id, { title: 'Achats' })
  const base = (await api.get(db.id)).schema
  await api.updateSchema(db.id, {
    ...base,
    properties: [
      ...base.properties,
      { id: 'prix', name: 'Prix', type: 'number' },
      {
        id: 'cat',
        name: 'Catégorie',
        type: 'select',
        options: [
          { id: 'mat', name: 'Matériel', color: 'blue' },
          { id: 'log', name: 'Logiciel', color: 'green' }
        ]
      },
      { id: 'quand', name: 'Quand', type: 'date' },
      { id: 'urgent', name: 'Urgent', type: 'checkbox' }
    ]
  })
  for (const [title, prix, cat, urgent] of [
    ['Écran', 200, 'mat', true],
    ['Souris', 20, 'mat', false],
    ['Antivirus', 60, 'log', true]
  ])
    await api.createRow(db.id, { title, properties: { prix, cat, urgent, quand: { start: day } } })
  return db.id
}, iso(today))
await win.evaluate((i) => localStorage.setItem('currentId', i), id)
await win.reload()
await win.locator('.db-table').waitFor()

// Sum under the price column
const priceFooter = win.locator('.calc-row td').nth(2)
await priceFooter.hover()
await priceFooter.locator('.calc-cell').click()
await win.locator('.popover .menu-item', { hasText: 'Somme' }).click()
await win.locator('.calc-cell.set', { hasText: '280' }).waitFor()

// Wider price column, saved in the view
const head = win.locator('.db-table thead th').nth(2)
const box = await head.boundingBox()
await win.mouse.move(box.x + box.width - 1, box.y + box.height / 2)
await win.mouse.down()
await win.mouse.move(box.x + box.width + 120, box.y + box.height / 2, { steps: 5 })
await win.mouse.up()
await win.waitForFunction(
  async (i) => ((await window.api.databases.get(i)).schema.views[0].widths?.prix ?? 0) > 250,
  id
)

// Filter group: urgent, and (expensive or software)
await win.getByRole('button', { name: /^Filtrer/ }).click()
await win
  .locator('.filter-popover')
  .getByRole('button', { name: '+ Ajouter un groupe de filtres' })
  .click()
await win.locator('.filter-popover').getByRole('button', { name: '+ Ajouter un filtre' }).click()
const top = win.locator('.filter-popover > .filter-row').first()
await top.locator('select').nth(0).selectOption({ label: 'Urgent' })
const group = win.locator('.filter-group').first()
await group.locator('.filter-row').nth(0).locator('select').nth(0).selectOption({ label: 'Prix' })
await group.locator('.filter-row').nth(0).locator('select').nth(1).selectOption({ label: '>' })
await group.locator('.filter-row').nth(0).locator('input').fill('100')
await group
  .locator('.filter-row')
  .nth(1)
  .locator('select')
  .nth(0)
  .selectOption({ label: 'Catégorie' })
await group
  .locator('.filter-row')
  .nth(1)
  .locator('select')
  .nth(2)
  .selectOption({ label: 'Logiciel' })
await win.keyboard.press('Escape')
await win.waitForFunction(
  () => document.querySelectorAll('.db-table tbody tr[data-row-id]').length === 2
)
const titles = await win.locator('.db-table tbody tr[data-row-id] .title-cell').allInnerTexts()
assert.deepEqual(titles.sort(), ['Antivirus', 'Écran'])

// Relative date: this week keeps today's rows
await win.getByRole('button', { name: /^Filtrer/ }).click()
await top.locator('select').nth(0).selectOption({ label: 'Quand' })
await top.locator('.filter-date select').selectOption({ label: 'Cette semaine' })
await win.keyboard.press('Escape')
await win.waitForFunction(
  () => document.querySelectorAll('.db-table tbody tr[data-row-id]').length === 2
)

// CSV import adds rows (and a "Matériel" option already known)
const chooser = win.waitForEvent('filechooser')
await win.getByTitle('Réglages de la base').click()
await win.locator('.popover .menu-item', { hasText: 'Importer un fichier CSV' }).click()
await (await chooser).setFiles(csv)
await win.locator('.notice', { hasText: '2 ligne(s) importée(s)' }).waitFor()

// Calendar: drag a row to another day
await win.getByLabel('Ajouter une vue').click()
await win.locator('.popover .menu-item', { hasText: 'Calendrier' }).click()
const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() === 1 ? 2 : 1)
const item = win.locator(`.calendar-day[data-date="${iso(today)}"] .calendar-item`, {
  hasText: 'Souris'
})
await item.dragTo(win.locator(`.calendar-day[data-date="${iso(target)}"]`))
await win.waitForFunction(
  async ([i, day]) =>
    (await window.api.databases.get(i)).rows.find((r) => r.title === 'Souris').properties.quand
      .start === day,
  [id, iso(target)]
)

await win.screenshot({ path: join(tmp, 'dbviews2.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK dbviews2 e2e, screenshot: ${join(tmp, 'dbviews2.png')}`)
