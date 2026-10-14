// E2E for phase 2 blocks: table, callout, toggle, image, formatting menu, block drag.
// Run after `npm run build`: node tests/e2e/blocks.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { unzipSync } from 'fflate'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-blocks-'))
const png = join(tmp, 'pixel.png')
writeFileSync(
  png,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)
const outZip = join(tmp, 'page.zip')
const launch = () =>
  electron.launch({ args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`] })

let app = await launch()
await app.evaluate(({ dialog }, out) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: out })
}, outZip)
let win = await app.firstWindow()
await win.getByRole('button', { name: 'Créer une page' }).click()
await win.locator('.page-title').fill('Blocs')
await win.locator('.page-title').press('Enter')

// The empty line kept at the end of the page lets the user leave a block.
const lastLine = () => win.locator('.editor .ProseMirror > p:last-child').click()

const slash = async (query, item) => {
  await win.keyboard.type(`/${query}`)
  await win.locator('.slash-item', { hasText: item }).first().waitFor()
  await win.keyboard.press('Enter')
}

// formatting bubble on a selection
await win.keyboard.type('Texte important')
await win.keyboard.press('Shift+Home')
// The menu appears ~250 ms after the selection, then the autosave (400 ms after typing)
// re-renders the page: the menu must still be there afterwards.
await win.waitForTimeout(800)
const focus = await win.evaluate(() => ({
  doc: document.hasFocus(),
  editor: document.activeElement?.className ?? ''
}))
assert.ok(
  await win.locator('.bubble').isVisible(),
  `formatting menu hidden (window focus: ${JSON.stringify(focus)})`
)
await win.locator('.bubble').getByRole('button', { name: 'B', exact: true }).click()
await win.locator('.editor p strong', { hasText: 'Texte important' }).waitFor()
await win.keyboard.press('ArrowRight') // collapse the selection at its end (End only scrolls on macOS)
// ProseMirror learns about the native selection change on the next selectionchange event;
// an instant Enter would still see the old selection and replace the text.
await win.waitForTimeout(100)
await win.keyboard.press('Enter')

// callout with a chosen icon
await slash('callout', 'Callout')
await win.keyboard.type('Attention')
await win.locator('.callout-icon').click()
await win.locator('.callout-icons button', { hasText: '⚠️' }).click()
assert.equal(await win.locator('.callout-icon').innerText(), '⚠️')
await lastLine()

// toggle
await slash('toggle', 'Toggle')
await win.keyboard.type('Résumé du toggle')
assert.equal(await win.locator('.editor div[data-type="details"]').count(), 1)

// table, then the table menu adds a row
await lastLine()
await slash('tabl', 'Tableau')
await win.keyboard.type('Nom')
assert.equal(await win.locator('.editor table tr').count(), 3)
await win.locator('.bubble').getByRole('button', { name: '+ Ligne', exact: true }).click()
assert.equal(await win.locator('.editor table tr').count(), 4)

// image from the file picker, served by the local asset protocol
await lastLine()
const chooser = win.waitForEvent('filechooser')
await slash('image', 'Image')
await (await chooser).setFiles(png)
const img = win.locator('.editor img')
await img.waitFor()
await win.waitForFunction(() => document.querySelector('.editor img')?.naturalWidth === 1)
assert.match(await img.getAttribute('src'), /^notionix-asset:\/\/file\/[0-9a-f]{64}\.png$/)

// drag the callout above the first paragraph with the block handle
const blockTypes = () =>
  win.evaluate(() =>
    [...document.querySelector('.editor .ProseMirror').children].map(
      (el) => el.tagName.toLowerCase() + (el.dataset.type ? `:${el.dataset.type}` : '')
    )
  )
const before = await blockTypes()
await win.locator('.editor aside.callout').hover({ position: { x: 60, y: 10 } })
const handle = win.locator('.block-handle.visible')
await handle.waitFor()
await handle.dragTo(win.locator('.editor p').first(), { targetPosition: { x: 10, y: 2 } })
const after = await blockTypes()
assert.notDeepEqual(after, before, `block order unchanged: ${before}`)
assert.equal(
  await win.locator('.editor .ProseMirror > :first-child aside.callout').count(),
  1,
  `callout not moved first: ${after}`
)
// page icon and gradient cover
await win.locator('.page').hover()
await win.getByRole('button', { name: 'Ajouter une icône' }).click()
await win.locator('.page-icon').click()
await win.locator('.emoji-grid button', { hasText: '🚀' }).click()
assert.equal(await win.locator('.page-icon').innerText(), '🚀')
await win.locator('.page').hover()
await win.getByRole('button', { name: 'Ajouter une couverture' }).click()
await win.getByRole('button', { name: 'Dégradé 4' }).click()
await win.locator('.page-cover').waitFor()
await win.locator('.row', { hasText: '🚀' }).waitFor()
await win.waitForTimeout(700)
await app.close()

// everything persisted
app = await launch()
await app.evaluate(({ dialog }, out) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: out })
}, outZip)
win = await app.firstWindow()
await win.locator('.editor table').waitFor()
assert.equal(await win.locator('.editor table tr').count(), 4)
assert.equal(await win.locator('.callout-icon').innerText(), '⚠️')
assert.equal(await win.locator('.page-icon').innerText(), '🚀')
await win.locator('.page-cover').waitFor()
assert.equal(await win.locator('.editor div[data-type="details"]').count(), 1)
await win.waitForFunction(() => document.querySelector('.editor img')?.naturalWidth === 1)
await win.screenshot({ path: join(tmp, 'blocks.png') })

// page export embeds the image next to the Markdown
await win.locator('.row', { hasText: 'Blocs' }).hover()
await win.locator('.row-actions button[title="Plus"]').click()
await win.getByRole('button', { name: 'Exporter en Markdown' }).click()
await win.locator('.notice').waitFor()
const zip = unzipSync(new Uint8Array(readFileSync(outZip)))
const names = Object.keys(zip)
assert.ok(names.includes('Blocs.md'), names.join(', '))
assert.ok(
  names.some((n) => /^Blocs\/[0-9a-f]{64}\.png$/.test(n)),
  names.join(', ')
)
const md = Buffer.from(zip['Blocs.md']).toString()
for (const part of [
  '<aside>',
  '⚠️ Attention',
  '<details>',
  '| Nom |',
  '](Blocs/',
  '**Texte important**'
]) {
  assert.ok(md.includes(part), `missing ${part} in:\n${md}`)
}
console.log('OK blocks e2e, screenshot:', join(tmp, 'blocks.png'))
await app.close()
