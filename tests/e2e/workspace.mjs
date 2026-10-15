// E2E: templates, backlinks, recent pages in search, HTML and PDF export.
// Run after `npm run build`: node tests/e2e/workspace.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-workspace-'))
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const out = { html: join(tmp, 'page.html'), pdf: join(tmp, 'page.pdf') }
await app.evaluate(({ dialog }, files) => {
  dialog.showSaveDialog = async (_w, options) => ({
    canceled: false,
    filePath: (options ?? _w).defaultPath?.endsWith('.pdf') ? files.pdf : files.html
  })
}, out)
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.locator('.blank').waitFor()

// Template: a project page with its task database inside it
await win.getByRole('button', { name: 'Modèles' }).click()
await win.locator('.template-card', { hasText: 'Projet' }).click()
await win.locator('.page-title').waitFor()
assert.equal(await win.locator('.page-title').inputValue(), 'Nouveau projet')
await win.locator('.inline-database .db-table', { hasText: 'Réalisation' }).waitFor()
const tree = await win.evaluate(async () => {
  const pages = await window.api.pages.list()
  const project = pages.find((p) => p.title === 'Nouveau projet')
  const tasks = pages.find((p) => p.title === 'Tâches')
  return { project: project.id, tasksParent: tasks.parentId }
})
assert.equal(tree.tasksParent, tree.project)

// Backlinks: a page mentioning the project
await win.getByRole('button', { name: '+ Nouvelle page' }).click()
await win.locator('.page-title').fill('Notes')
await win.locator('.page-title').press('Enter')
await win.keyboard.type('Voir @Nouveau', { delay: 30 })
await win.locator('.slash-item', { hasText: 'Nouveau projet' }).first().click()
await win.waitForTimeout(800)
await win.locator('.editor .mention-page').click()
await win.locator('.backlinks-toggle', { hasText: '1 rétrolien' }).click()
await win.locator('.backlinks-list button', { hasText: 'Notes' }).waitFor()

// Search lists recent pages before typing
await win.keyboard.press('Meta+K')
await win.locator('.dialog .menu-label', { hasText: 'Récents' }).waitFor()
assert.ok((await win.locator('.dialog .hit').count()) >= 2)
await win.keyboard.press('Escape')

// Exports from the page menu
await win.getByTitle('Options de la page').click()
await win.locator('.page-options').getByRole('button', { name: 'Exporter en HTML' }).click()
await win.locator('.notice', { hasText: 'Exporté' }).waitFor()
assert.ok(existsSync(out.html) || existsSync(out.html.replace('.html', '.zip')))
await win.getByTitle('Options de la page').click()
await win.locator('.page-options').getByRole('button', { name: 'Exporter en PDF' }).click()
await win.waitForFunction(() => document.querySelector('.notice')?.textContent?.includes('.pdf'))
assert.equal(readFileSync(out.pdf).subarray(0, 4).toString(), '%PDF')

// Saving a page as a template lists it in the gallery
await win.getByTitle('Options de la page').click()
await win.locator('.page-options').getByText('Enregistrer comme modèle').click()
await win.keyboard.press('Escape')
await win.getByRole('button', { name: 'Modèles' }).click()
await win.locator('.template-card', { hasText: 'Nouveau projet' }).waitFor()
await win.keyboard.press('Escape')

await win.screenshot({ path: join(tmp, 'workspace.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK workspace e2e, screenshot: ${join(tmp, 'workspace.png')}`)
