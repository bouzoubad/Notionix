// E2E for databases shown inside a page. Run after `npm run build`: node tests/e2e/inline.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { strToU8, zipSync } from 'fflate'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-inline-'))
const launch = () =>
  electron.launch({ args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`] })
let app = await launch()
let win = await app.firstWindow()

// "/Base de données" inserts a database block inside the page
await win.getByRole('button', { name: 'Créer une page' }).click()
await win.locator('.page-title').fill('Réunion')
await win.locator('.page-title').press('Enter')
await win.keyboard.type('Actions :')
await win.keyboard.press('Enter')
await win.keyboard.type('/base')
await win.locator('.slash-item', { hasText: 'Base de données' }).waitFor()
await win.keyboard.press('Enter')
const block = win.locator('.inline-database')
await block.locator('.db-table').waitFor()

// editing inside the block stays in the database, not in the page text
await block.getByRole('button', { name: '+ Nouvelle ligne' }).click()
await block.locator('tbody tr td').first().locator('.cell').click()
await win.keyboard.type('Envoyer le compte rendu')
await win.keyboard.press('Enter')
await win.waitForTimeout(500)
assert.equal(
  await block.locator('tbody tr td').first().locator('.cell').innerText(),
  'Envoyer le compte rendu'
)
assert.ok(
  !(await win.locator('.editor .ProseMirror > p').allInnerTexts()).some((t) =>
    t.includes('Envoyer')
  )
)
// the database is also a sub-page of the page
// (creating it expanded the page in the sidebar)
assert.equal(await win.locator('.sidebar .row .icon', { hasText: '🗃️' }).count(), 1)
await win.waitForTimeout(600)
await app.close()

app = await launch()
win = await app.firstWindow()
await win.locator('.inline-database .db-table tbody tr').first().waitFor()
assert.equal(await win.locator('.inline-database tbody tr').count(), 1)

// a Notion page with a database inside imports with the block in place
const home = 'a'.repeat(32)
const tasks = 'b'.repeat(32)
const zip = join(tmp, 'export.zip')
writeFileSync(
  zip,
  zipSync({
    [`Sprint ${home}.md`]: strToU8(
      `# Sprint\n\nObjectifs de la semaine.\n\n[Tâches](Sprint%20${home}/T%C3%A2ches%20${tasks}.csv)\n`
    ),
    [`Sprint ${home}/Tâches ${tasks}.csv`]: strToU8(
      'Name,Status,Points\nMaquettes,In progress,3\nTests,Todo,2\nDéploiement,Todo,5\n'
    )
  })
)
await app.evaluate(({ dialog }, path) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
}, zip)
await win.getByRole('button', { name: 'Importer / Exporter' }).click()
await win.getByRole('button', { name: 'Choisir un export Notion…' }).click()
await win.locator('.import-report').waitFor()
await win.keyboard.press('Escape')
await win
  .locator('.overlay')
  .click({ position: { x: 5, y: 5 } })
  .catch(() => {})
await win.locator('.row', { hasText: 'Importé de Notion' }).locator('.chevron').click()
await win.locator('.row', { hasText: 'Sprint' }).click()
await win.locator('.inline-database .db-table tbody tr').nth(2).waitFor()
assert.deepEqual(
  await win.locator('.inline-database tbody tr td:first-child .cell').allInnerTexts(),
  ['Maquettes', 'Tests', 'Déploiement']
)
assert.equal(await win.locator('.inline-database .inline-database-title').innerText(), '🗃️ Tâches')
await win.screenshot({ path: join(tmp, 'inline.png') })
console.log('OK inline e2e, screenshot:', join(tmp, 'inline.png'))
await app.close()
