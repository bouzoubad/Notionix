// E2E: import a Notion-style export through the UI, then export to Markdown.
// Run after `npm run build`: node tests/e2e/transfer.mjs
import { _electron as electron } from 'playwright-core'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-transfer-'))
const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const files = {
  [`Roadmap ${A}.md`]: `# Roadmap\n\nVoir [Détails](Roadmap%20${A}/D%C3%A9tails%20${B}.md).\n\n- [x] Importer Notion\n- [ ] Tout migrer\n`,
  [`Roadmap ${A}/Détails ${B}.md`]: '# Détails\n\n<aside>\n💡 Penser aux images\n\n</aside>\n'
}
const zipPath = join(tmp, 'notion-export.zip')
writeFileSync(
  zipPath,
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
)
const outPath = join(tmp, 'out.zip')

const app = await electron.launch({ args: ['.', `--user-data-dir=${join(tmp, 'profile')}`] })
await app.evaluate(
  ({ dialog }, { zipPath, outPath }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [zipPath] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: outPath })
  },
  { zipPath, outPath }
)
const win = await app.firstWindow()

await win.getByRole('button', { name: 'Importer / Exporter' }).click()
await win.getByRole('button', { name: 'Choisir un export Notion…' }).click()
await win.locator('.import-report, .error').first().waitFor()
if (await win.locator('.error').count()) throw new Error(await win.locator('.error').innerText())
assert.match(await win.locator('.import-report').innerText(), /3 page\(s\) créée\(s\)/)
await win.screenshot({ path: join(tmp, 'import.png') })
console.log('screenshot:', join(tmp, 'import.png'))
await win.getByRole('button', { name: 'Ouvrir les pages importées' }).click()

// the container, then the imported page with its content
await win.locator('.row', { hasText: 'Importé de Notion' }).waitFor()
await win.locator('.chevron').first().click()
await win.locator('.row', { hasText: 'Roadmap' }).click()
await win.locator('.editor ul[data-type="taskList"]').waitFor()
assert.equal(await win.locator('.editor li[data-checked="true"]').count(), 1)

// internal link opens the linked page
await win.locator('.editor a', { hasText: 'Détails' }).click()
await win.locator('.editor blockquote', { hasText: 'Penser aux images' }).waitFor()
assert.equal(await win.locator('.page-title').inputValue(), 'Détails')

// export everything
await win.getByRole('button', { name: 'Importer / Exporter' }).click()
await win.getByRole('button', { name: 'Exporter toutes les pages…' }).click()
await win.locator('.notice').waitFor()
const zip = unzipSync(new Uint8Array(readFileSync(outPath)))
const names = Object.keys(zip).sort()
assert.deepEqual(
  names,
  [
    'Importé de Notion (' + new Date().toISOString().slice(0, 10) + ')/Roadmap.md',
    'Importé de Notion (' + new Date().toISOString().slice(0, 10) + ')/Roadmap/Détails.md',
    'Importé de Notion (' + new Date().toISOString().slice(0, 10) + ').md'
  ].sort()
)
const roadmap = Buffer.from(zip[names.find((n) => n.endsWith('/Roadmap.md'))]).toString()
assert.match(roadmap, /\[Détails\]\(Roadmap\/D%C3%A9tails\.md\)/)
console.log('OK transfer e2e')
await app.close()
