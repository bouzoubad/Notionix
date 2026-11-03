// E2E of writing, from the team's feedback: Enter after a "[[" that is only
// text, emojis (":name", /emoji, page icons), « Transformer en » from a
// selection, and the page's outline on its right edge.
// Run after `npm run build`: node tests/e2e/writing.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-writing-'))
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 1280, height: 860 })
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
const MAIN = '.page-body > .editor > .ProseMirror'
const paragraphs = () => win.locator(`${MAIN} > p`).allInnerTexts()

await win.getByRole('button', { name: 'Créer une page' }).click()
await win.locator('.page-title').fill('Écriture')
await win.locator('.page-title').press('Enter')

// Enter after a "[[" that is only text (« Tapez « [[ » pour lier… »): a new line
await win.keyboard.type('Tapez [[ » pour lier une autre page.Organiser')
// Characters such as « » are read by the editor a moment later.
await win.waitForTimeout(300)
for (let i = 0; i < 'Organiser'.length; i++) {
  await win.keyboard.press('ArrowLeft')
  await win.waitForTimeout(30)
}
await win.keyboard.press('Enter')
await win.waitForFunction((main) => document.querySelectorAll(`${main} > p`).length >= 2, MAIN)
assert.deepEqual((await paragraphs()).slice(0, 2), [
  'Tapez [[ » pour lier une autre page.',
  'Organiser'
])

// ":coeur" offers ❤️ first; Enter inserts it
// (macOS: Cmd+Right goes to the end of the line; End only scrolls)
await win.keyboard.press('Meta+ArrowRight')
await win.keyboard.type(' :coeur')
await win.locator('.slash-item', { hasText: '❤️' }).first().waitFor()
await win.keyboard.press('Enter')
await win.waitForFunction(
  (main) => document.querySelector(main)?.textContent?.includes('Organiser ❤️'),
  MAIN
)
// A colon in a sentence or a time stays text, no menu
await win.keyboard.type(' à 10:30 : fini')
await win.waitForTimeout(300)
assert.equal(await win.locator('.slash-menu').count(), 0)

// /emoji: the picker, searched in French, Enter inserts the first one
await win.keyboard.press('Enter')
await win.keyboard.type('/emoji')
await win.locator('.slash-item', { hasText: 'Émoji' }).first().click()
await win.locator('.emoji-popover .emoji-search').waitFor()
await win.locator('.emoji-popover .emoji-search').fill('fusée')
await win.locator('.emoji-popover .emoji-grid button').first().waitFor()
await win.locator('.emoji-popover .emoji-search').press('Enter')
await win.locator('.emoji-popover').waitFor({ state: 'detached' })
await win.waitForFunction((main) => document.querySelector(main)?.textContent?.includes('🚀'), MAIN)
await win.waitForTimeout(200)

// « Transformer en » from a selection: a double-clicked word's line becomes a heading
await win.keyboard.press('Enter')
await win.keyboard.type('Partie un')
// (on the word itself: the line is wider than its text)
await win.locator(`${MAIN} p`, { hasText: 'Partie un' }).dblclick({ position: { x: 20, y: 8 } })
await win.locator('.bubble-turn > button').click()
await win.locator('.bubble-turn-menu').getByRole('button', { name: 'Titre 1', exact: true }).click()
await win.locator(`${MAIN} h1`, { hasText: 'Partie un' }).waitFor()
// The text is no longer selected: typing goes after it
await win.keyboard.type(' (suite)')
await win.locator(`${MAIN} h1`, { hasText: 'Partie un (suite)' }).waitFor()
// Two more headings, and text to scroll
await win.keyboard.press('Enter')
for (const title of ['Partie deux', 'Partie trois']) {
  for (let i = 0; i < 12; i++) {
    await win.keyboard.type(`Une ligne de texte ${i}.`)
    await win.keyboard.press('Enter')
  }
  await win.keyboard.type(`## ${title}`)
  await win.keyboard.press('Enter')
}

// The outline on the right edge: one line per heading, the headings on hover
const outline = win.locator('.side-outline')
await outline.waitFor()
assert.equal(await outline.locator('.side-outline-marks span').count(), 3)
await outline.hover()
await outline.locator('.side-outline-panel button', { hasText: 'Partie un (suite)' }).click()
await win.waitForFunction(() =>
  document.querySelector('.side-outline-marks span:first-child')?.classList.contains('current')
)

// Page icon: « Ajouter une icône » picks one at random; clicked, the same picker, searched in English
await win.locator('.page').first().hover()
await win.getByRole('button', { name: 'Ajouter une icône' }).click()
await win.locator('.page-head .page-icon').click()
await win.locator('.icon-picker .emoji-search').fill('rocket')
await win.locator('.icon-picker .emoji-grid button').first().click()
await win.locator('.page-head .page-icon', { hasText: '🚀' }).waitFor()

await win.screenshot({ path: join(tmp, 'writing.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK writing e2e, screenshot: ${join(tmp, 'writing.png')}`)
