// E2E for the editor blocks of the team release: colors and block menu, columns,
// toggle headings, table of contents, link to a page, files, button, synced
// block, mentions, comments, history and page options.
// Run after `npm run build`: node tests/e2e/editor.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-editor-'))
const pdf = join(tmp, 'Devis.pdf')
writeFileSync(pdf, '%PDF-1.4\n% test\n')
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))

await win.getByRole('button', { name: 'Créer une page' }).click()
await win.locator('.page-title').fill('Cible')
await win.waitForTimeout(500)
await win.getByRole('button', { name: '+ Nouvelle page' }).click()
await win.locator('.page-title').fill('Blocs avancés')
await win.locator('.page-title').press('Enter')

const slash = async (query, item) => {
  await win.keyboard.type(`/${query}`)
  await win.locator('.slash-item', { hasText: item }).first().waitFor()
  await win.locator('.slash-item', { hasText: item }).first().click()
}
// The page's own editor (blocks such as synced ones hold editors of their own).
const MAIN = '.page-body > .editor > .ProseMirror'
const lastLine = () => win.locator(`${MAIN} > p:last-child`).click()

// Block color from the block menu
await win.keyboard.type('Ligne colorée')
await win.locator('.editor .ProseMirror > p').first().hover()
await win.locator('.block-handle').click()
await win.locator('.block-menu').getByRole('button', { name: 'Couleur ›' }).click()
await win
  .locator('.block-menu')
  .getByRole('button', { name: /Fond rouge/ })
  .click()
await win.locator(".editor p[data-color='red_background']").waitFor()

// Turn into a toggle heading
await win.locator('.editor .ProseMirror > p').first().hover()
await win.locator('.block-handle').click()
await win.locator('.block-menu').getByRole('button', { name: 'Transformer en ›' }).click()
await win.locator('.block-menu').getByRole('button', { name: 'Titre 2 repliable' }).click()
await win.locator(".editor .toggle[data-heading='2']").waitFor()

// Columns, table of contents, link to a page
await win.locator('.editor .toggle summary', { hasText: 'Ligne colorée' }).waitFor()
await lastLine()
await slash('colon', '2 colonnes')
await win.keyboard.type('Gauche')
await win.locator('.editor .columns .column').nth(1).click()
await win.keyboard.type('Droite')
assert.equal(await win.locator('.editor .columns .column').count(), 2)
assert.equal(await win.locator('.editor .columns .column').first().innerText(), 'Gauche')
await lastLine()
await win.keyboard.type('## Partie A')
await win.keyboard.press('Enter')
await slash('matie', 'Table des matières')
await win.locator('.toc-item', { hasText: 'Partie A' }).waitFor()
await lastLine()
await slash('lien', 'Lien vers une page')
await win.locator('.dialog input').fill('Cible')
await win.keyboard.press('Enter')
await win.locator('.page-link-block', { hasText: 'Cible' }).waitFor()

// File block from the file picker
await lastLine()
const chooser = win.waitForEvent('filechooser')
await slash('fichier', 'Fichier')
await (await chooser).setFiles(pdf)
await win.locator('.file-block', { hasText: 'Devis.pdf' }).waitFor()

// Button inserting blocks
await lastLine()
await slash('bouton', 'Bouton')
await win.locator('.button-block-button').click()
assert.ok((await win.locator('.editor .ProseMirror > p').count()) >= 2)

// Synced block: its content lives in a hidden page
await lastLine()
await slash('synchro', 'Bloc synchronisé')
await win.locator('.synced-block .sub-editor .ProseMirror').click()
await win.keyboard.type('Contenu partagé')
await win.waitForTimeout(800)
const hidden = await win.evaluate(async () =>
  (await window.api.pages.list()).filter((p) => p.kind === 'synced')
)
assert.equal(hidden.length, 1)
const source = await win.evaluate(
  async (id) => (await window.api.pages.get(id)).content,
  hidden[0].id
)
assert.ok(source.includes('Contenu partagé'), 'synced content saved in its hidden page')
assert.equal(await win.locator('.sidebar .row', { hasText: 'Sans titre' }).count(), 0)

// Mentions: a page and a date with a reminder
await lastLine()
await win.keyboard.type('Voir @Cib', { delay: 30 })
await win.locator('.slash-item', { hasText: 'Cible' }).first().click()
await win.keyboard.type('le @demain', { delay: 30 })
await win.locator('.slash-item', { hasText: 'Rappel' }).first().click()
await win.locator('.editor .mention-page', { hasText: 'Cible' }).waitFor()
await win.locator('.editor .mention-date', { hasText: '09:00' }).waitFor()

// Comment on a selection, then resolve it
await win.locator('.editor .columns .column p').first().click()
await win.keyboard.press('Shift+Home')
await win.waitForTimeout(400)
await win.locator('.bubble').getByRole('button', { name: '💬 Commenter' }).click()
await win.locator('.comments-panel textarea').first().fill('À revoir')
await win.locator('.comments-panel').getByRole('button', { name: 'Envoyer' }).click()
await win.locator('.comments-panel .comment-body', { hasText: 'À revoir' }).waitFor()
assert.equal(await win.locator('.editor .comment-mark').count(), 1)
await win.locator('.comments-panel').getByRole('button', { name: '✓ Résoudre' }).click()
await win.waitForFunction(() => document.querySelectorAll('.editor .comment-mark').length === 0)
await win.locator('.comments-panel header button').click()

// History lists the saved states
await win.waitForTimeout(600)
await win.getByRole('button', { name: 'Historique' }).click()
await win.locator('.history-list > button').first().waitFor()
await win.locator('.dialog.history').getByRole('button', { name: 'Fermer' }).click()

// Page options: full width, then lock (read-only)
await win.getByTitle('Options de la page').click()
await win.locator('.page-options').getByText('Pleine largeur').click()
await win.locator('.page.opt-full-width').waitFor()
await win.locator('.page-options').getByText('Verrouiller la page').click()
await win.waitForFunction(
  (main) => document.querySelector(main)?.getAttribute('contenteditable') === 'false',
  MAIN
)
await win.keyboard.press('Escape')

await win.screenshot({ path: join(tmp, 'editor.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK editor e2e, screenshot: ${join(tmp, 'editor.png')}`)
