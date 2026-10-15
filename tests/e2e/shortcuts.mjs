// E2E: page addresses and history, /page, [[ links, Notion's shortcuts and
// Markdown rules. Run after `npm run build`: node tests/e2e/shortcuts.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-shortcuts-'))
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.locator('.blank').waitFor()
const MAIN = '.page-body > .editor > .ProseMirror'
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

// New page with Cmd+N; its address follows
await win.keyboard.press(`${mod}+n`)
await win.locator('.page-title').fill('Accueil')
await win.locator('.page-title').press('Enter')
const home = await win.evaluate(() => location.hash)
assert.match(home, /^#\/page\//)

// Markdown rules: '>' toggle, '[]' to-do, '"' quote
await win.keyboard.type('> Détails')
await win.locator(`${MAIN} .toggle`).waitFor()
await win.locator(`${MAIN} > p:last-child`).click()
await win.keyboard.type('[] Acheter du pain')
await win.locator(`${MAIN} ul[data-type="taskList"]`).waitFor()
await win.locator(`${MAIN} > p:last-child`).click()
await win.keyboard.type('" Une citation')
await win.locator(`${MAIN} blockquote`).waitFor()

// Turn into a heading (Cmd+Alt+1), duplicate (Cmd+D)
await win.locator(`${MAIN} > p:last-child`).click()
await win.keyboard.type('Titre rapide')
await win.keyboard.press(`${mod}+Alt+1`)
await win.locator(`${MAIN} h1`, { hasText: 'Titre rapide' }).waitFor()
await win.keyboard.press(`${mod}+d`)
assert.equal(await win.locator(`${MAIN} h1`, { hasText: 'Titre rapide' }).count(), 2)

// [[ links to a page; /page creates a sub-page and opens it
await win.locator(`${MAIN} > p:last-child`).click()
await win.keyboard.type('/page')
await win.locator('.slash-item', { hasText: 'Sous-page dans cette page' }).first().click()
await win.waitForFunction((h) => location.hash !== h, home)
await win.locator('.page-title').fill('Sous-page')
await win.locator('.page-title').press('Enter')
await win.keyboard.type('Retour vers [[Accu')
await win.locator('.slash-item', { hasText: 'Accueil' }).first().click()
await win.locator(`${MAIN} .mention-page`, { hasText: 'Accueil' }).waitFor()

// Back (Cmd+[) returns to the first page, which links to the sub-page
await win.waitForTimeout(600)
await win.keyboard.press(`${mod}+BracketLeft`)
await win.waitForFunction((h) => location.hash === h, home)
await win.locator('.page-link-block', { hasText: 'Sous-page' }).waitFor()
await win.keyboard.press(`${mod}+BracketRight`)
await win.waitForFunction((h) => location.hash !== h, home)

// Sidebar (Cmd+\), theme (Cmd+Shift+L), shortcuts (Cmd+/)
await win.keyboard.press(`${mod}+Backslash`)
assert.equal(await win.locator('.sidebar').isVisible(), false)
await win.keyboard.press(`${mod}+Backslash`)
const before = await win.evaluate(() => getComputedStyle(document.body).backgroundColor)
await win.keyboard.press(`${mod}+Shift+l`)
const after = await win.evaluate(() => getComputedStyle(document.body).backgroundColor)
assert.notEqual(before, after, 'theme did not change')
await win.keyboard.press(`${mod}+Slash`)
await win.locator('.dialog.shortcuts').waitFor()
// Escape closes it, wherever the focus is in it.
await win.keyboard.press('Escape')
await win.locator('.dialog.shortcuts').waitFor({ state: 'detached' })

// Copy link from the page menu
await win.getByTitle('Options de la page').click()
await win.locator('.page-options').getByRole('button', { name: 'Copier le lien' }).click()
await win.locator('.notice', { hasText: 'Lien' }).waitFor()

assert.deepEqual(errors, [])
await app.close()
console.log('OK shortcuts e2e')
