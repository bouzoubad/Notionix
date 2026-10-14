// Smoke test: node tests/e2e/smoke.mjs (requires `npm run build` first)
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const userData = mkdtempSync(join(tmpdir(), 'notionix-e2e-'))
const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] })

let app = await launch()
let win = await app.firstWindow()
await win.getByRole('button', { name: 'Créer une page' }).click()
await win.locator('.page-title').fill('Ma première page')
await win.locator('.page-title').press('Enter')
await win.keyboard.type('Bonjour Notionix')
await win.keyboard.press('Enter')
await win.keyboard.type('/tit')
await win.locator('.slash-item', { hasText: 'Titre 1' }).waitFor()
await win.keyboard.press('Enter')
await win.keyboard.type('Un grand titre')
await win.waitForTimeout(700)
assert.equal(await win.locator('.editor h1').innerText(), 'Un grand titre')

// sub page + search + persistence across restart
await win.locator('.row', { hasText: 'Ma première page' }).hover()
await win.locator('.row-actions button[title="Sous-page"]').click()
await win.locator('.page-title').fill('Enfant')
await win.waitForTimeout(700)
await app.close()

app = await launch()
win = await app.firstWindow()
await win.locator('.row', { hasText: 'Ma première page' }).waitFor()
await win.keyboard.press('Meta+k')
await win.locator('.dialog input').fill('grand')
await win.locator('.hit', { hasText: 'Ma première page' }).waitFor()
await win.keyboard.press('Enter')
assert.equal(await win.locator('.editor h1').innerText(), 'Un grand titre')
assert.equal(await win.locator('.page-title').inputValue(), 'Ma première page')
await win.screenshot({ path: join(userData, 'shot.png') })
console.log('OK, screenshot:', join(userData, 'shot.png'))
await app.close()
