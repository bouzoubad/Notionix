// E2E for databases (table view): node tests/e2e/database.mjs after `npm run build`
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-db-'))
const launch = () => electron.launch({ args: ['.', `--user-data-dir=${join(tmp, 'profile')}`] })
let app = await launch()
let win = await app.firstWindow()

await win.getByRole('button', { name: '+ Nouvelle base de données' }).click()
await win.locator('.page-title').fill('Tâches')
await win.locator('.page-title').press('Enter')

const addProperty = async (typeLabel, name) => {
  await win.getByRole('button', { name: 'Ajouter une propriété' }).click()
  await win.locator('.popover .menu-item', { hasText: typeLabel }).first().click()
  const nameInput = win.getByLabel('Nom de la propriété')
  await nameInput.fill(name)
  await nameInput.press('Enter')
  await win.locator('.col-head', { hasText: name }).waitFor()
}
await addProperty('Sélection', 'Statut')
await addProperty('Nombre', 'Points')

const rows = () => win.locator('.db-table tbody tr')
const cell = (row, col) => rows().nth(row).locator('td').nth(col).locator('.cell').first()
const typeIn = async (row, col, text) => {
  await cell(row, col).click()
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
}
for (const [i, [title, status, points]] of [
  ['Écrire la doc', 'En cours', '3'],
  ['Corriger le bug', 'Terminé', '1'],
  ['Planifier', 'En', '8']
].entries()) {
  await win.getByRole('button', { name: '+ Nouvelle ligne' }).click()
  await rows().nth(i).waitFor()
  await typeIn(i, 0, title)
  await typeIn(i, 1, status) // creates the option, or picks "En cours" for "En"
  await win.keyboard.press('Escape')
  await typeIn(i, 2, points)
}
await win.waitForTimeout(300)
assert.deepEqual(await rows().locator('td:nth-child(2) .tag').allInnerTexts(), [
  'En cours',
  'Terminé',
  'En cours'
])
assert.deepEqual(await rows().locator('td:nth-child(3)').allInnerTexts(), ['3', '1', '8'])

// filter Points ≥ 3, then sort by Points descending
await win.getByRole('button', { name: /^Filtrer/ }).click()
await win.getByRole('button', { name: '+ Ajouter un filtre' }).click()
await win.locator('.filter-row select').first().selectOption({ label: 'Points' })
await win.locator('.filter-row select').nth(1).selectOption({ label: '≥' })
await win.locator('.filter-row input').fill('3')
await win.keyboard.press('Escape')
await win.waitForTimeout(200)
assert.equal(await rows().count(), 2)
await win.getByRole('button', { name: /^Trier/ }).click()
await win.getByRole('button', { name: '+ Ajouter un tri' }).click()
await win.locator('.filter-row select').first().selectOption({ label: 'Points' })
await win.locator('.filter-row select').nth(1).selectOption({ label: 'Décroissant' })
await win.keyboard.press('Escape')
await win.waitForTimeout(200)
assert.deepEqual(await rows().locator('td:first-child .cell').allInnerTexts(), [
  'Planifier',
  'Écrire la doc'
])

// open a row: its properties are editable under the title
await rows().first().hover()
await rows().first().getByRole('button', { name: 'Ouvrir' }).click()
await win.locator('.row-properties').waitFor()
assert.equal(await win.locator('.page-title').inputValue(), 'Planifier')
assert.equal(
  await win.locator('.row-property', { hasText: 'Statut' }).locator('.tag').innerText(),
  'En cours'
)
await win.locator('.row-property', { hasText: 'Points' }).locator('.cell').click()
await win.keyboard.press('Meta+a')
await win.keyboard.type('13')
await win.keyboard.press('Enter')
await win.waitForTimeout(200)
await win.locator('.breadcrumbs button', { hasText: 'Tâches' }).click()
await win.locator('.db-table').waitFor()
assert.deepEqual(await rows().locator('td:nth-child(3)').allInnerTexts(), ['13', '3'])

// change Points to text: values are converted
await win.locator('.col-head', { hasText: 'Points' }).click()
await win.locator('.property-menu select').first().selectOption({ label: 'Texte' })
await win.waitForTimeout(400)
await win.keyboard.press('Escape')
// the "Points ≥ 3" filter no longer applies to a text property and is removed
await win.waitForTimeout(300)
assert.equal(await win.getByRole('button', { name: /^Filtrer/ }).innerText(), 'Filtrer')
assert.deepEqual(await rows().locator('td:nth-child(3)').allInnerTexts(), ['13', '3', '1'])
await win.screenshot({ path: join(tmp, 'table.png') })
await app.close()

// persisted; rows are searchable by property values; rows do not clutter the sidebar
app = await launch()
win = await app.firstWindow()
await win.locator('.db-table').waitFor()
assert.equal(await win.locator('.sidebar .row').count(), 1)
await win.keyboard.press('Meta+k')
await win.locator('.dialog input').fill('termine')
await win.locator('.hit', { hasText: 'Corriger le bug' }).waitFor()
console.log('OK database e2e, screenshot:', join(tmp, 'table.png'))
await app.close()
