// E2E: page tabs, first steps (tour, "Bien démarrer" page), keyboard use of
// the sidebar tree and of dialogs. Run after `npm run build`: node tests/e2e/ergonomics.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-ergonomics-'))
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.locator('.blank').waitFor()
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const command = (name) =>
  app.evaluate(({ BrowserWindow }, c) => {
    BrowserWindow.getAllWindows()[0].webContents.send('app:command', c)
  }, name)

// First steps: the tour, then the "Bien démarrer" page
await win.getByRole('button', { name: /Visite guidée/ }).click()
const tour = win.getByRole('dialog', { name: 'Bienvenue dans Notionix' })
await tour.waitFor()
await win.keyboard.press('ArrowRight')
await win.getByRole('dialog', { name: 'Des pages imbriquées' }).waitFor()
await win.getByRole('button', { name: 'Passer' }).click()
await win.getByRole('button', { name: /Créer la page « Bien démarrer »/ }).click()
await win.waitForFunction(() => document.querySelector('.page-title')?.value === 'Bien démarrer')
await win.locator('.ProseMirror ul[data-type="taskList"] li').first().waitFor()
assert.ok((await win.locator('.ProseMirror ul[data-type="taskList"] li').count()) >= 9)

// Two more pages, one opened in a new tab with Cmd-click
await win.keyboard.press(`${mod}+n`)
await win.locator('.page-title').fill('Projets')
await win.locator('.page-title').press('Enter')
await win
  .locator('.sidebar [role="treeitem"]', { hasText: 'Bien démarrer' })
  .click({ modifiers: [mod] })
await win.locator('.tab-bar [role="tab"]').nth(1).waitFor()
assert.equal(
  await win
    .locator('.tab-bar [role="tab"][aria-selected="true"]')
    .innerText()
    .then((t) => t.includes('Bien démarrer')),
  true
)
await win.locator('.tab-bar [role="tab"]', { hasText: 'Projets' }).click()
await win.waitForFunction(() => document.querySelector('.page-title')?.value === 'Projets')
// Menu commands: a new tab, then closing it
await command('tab:new')
await win.locator('.tab-bar [role="tab"]').nth(2).waitFor()
await win.locator('.blank').waitFor()
await command('tab:close')
await win.waitForFunction(() => document.querySelectorAll('.tab-bar [role="tab"]').length === 2)
await win.locator('.page-tab-close').last().click()
await win.locator('.tab-bar').waitFor({ state: 'detached' })

// The sidebar tree with the keyboard: arrows, then Enter opens
const first = win.locator('.sidebar [role="treeitem"]').first()
await first.focus()
await win.keyboard.press('ArrowDown')
const focusedLabel = await win.evaluate(() => document.activeElement?.getAttribute('aria-label'))
assert.ok(focusedLabel, 'no row focused')
await win.keyboard.press('Enter')
await win.waitForFunction((t) => document.querySelector('.page-title')?.value === t, focusedLabel)

// Dialogs keep the focus inside and give it back
await win.locator('.sidebar [role="treeitem"]').first().focus()
await win.keyboard.press(`${mod}+p`)
const search = win.locator('.overlay > .dialog')
await search.waitFor()
assert.equal(await search.getAttribute('aria-modal'), 'true')
for (let i = 0; i < 12; i++) await win.keyboard.press('Tab')
assert.equal(
  await win.evaluate(() => !!document.activeElement?.closest('.overlay > .dialog')),
  true
)
await win.keyboard.press('Escape')
await search.waitFor({ state: 'detached' })
assert.equal(await win.evaluate(() => document.activeElement?.getAttribute('role')), 'treeitem')

// The skip link reaches the page
await win.locator('.skip-link').focus()
await win.keyboard.press('Enter')
assert.equal(await win.evaluate(() => !!document.activeElement?.closest('#content')), true)

await win.screenshot({ path: join(tmp, 'ergonomics.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK ergonomics e2e, screenshot: ${join(tmp, 'ergonomics.png')}`)
