import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// E2E: the interface in English has no French text left on its main screens.
// Run after `npm run build`: node tests/e2e/english.mjs
import assert from 'assert'
const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-english-'))
const out = tmp
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'p')}`]
})
const win = await app.firstWindow()
await win.locator('.blank').waitFor()
await win.evaluate(() => localStorage.setItem('language', 'en'))
await win.reload()
await win.locator('.blank').waitFor()
// French words and letters that English texts do not have ("Français" names the language).
const FR =
  /\b(les|des|une|pour|avec|dans|Nouvelle|Nouveau|Ajouter|Rechercher|Supprimer|Sans titre|Corbeille|Modèles|Partager|Fermer|Créer|Choisir|Vide|Filtrer|Trier|Propriétés|ligne|Exporter|Importer|Tableau)\b|[éèàçêù]/
const report = []
const scan = async (name) => {
  await win.waitForTimeout(400)
  const lines = (await win.evaluate(() => document.body.innerText))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const french = [...new Set(lines.filter((l) => l !== 'Français' && FR.test(l)))]
  if (french.length) report.push(`## ${name}\n${french.join('\n')}`)
  await win.screenshot({ path: `${out}/${name}.png` })
}
await scan('home')
await win
  .getByRole('button', { name: /Getting started/ })
  .first()
  .click()
  .catch(() => {})
await win.waitForTimeout(800)
await scan('getting-started')
await win.keyboard.press('Meta+n')
await win.locator('.page-title').fill('Test')
await win.locator('.page-title').press('Enter')
await win.keyboard.type('/')
await scan('slash-menu')
await win.keyboard.press('Escape')
await win.evaluate(async () => {
  const db = await window.api.databases.create(null)
  await window.api.pages.update(db.id, { title: 'Tasks' })
  await window.api.databases.createRow(db.id, { title: 'One' })
  location.hash = `#/page/${db.id}`
})
await win.reload()
await win.locator('.db-table').waitFor()
await scan('database')
await win
  .getByRole('button', { name: /^Filter/ })
  .click()
  .catch(() => {})
await scan('filter')
await win.keyboard.press('Escape')
await win
  .locator('.db-table thead th')
  .nth(1)
  .locator('.col-head')
  .click()
  .catch(() => {})
await scan('property-menu')
await win.keyboard.press('Escape')
await win
  .getByRole('button', { name: /Import/ })
  .first()
  .click()
  .catch(() => {})
await scan('transfer')
await win.keyboard.press('Escape')
await win.keyboard.press('Meta+p')
await scan('search')
await win.keyboard.press('Escape')
await win.keyboard.press('Meta+Slash')
await scan('shortcuts')
await app.close()
assert.equal(report.join('\n\n'), '')
console.log(`OK english e2e, screenshots: ${out}`)
