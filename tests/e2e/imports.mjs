// E2E: imports from other tools (Word, Markdown, Evernote, Confluence), image
// page icons, filtered search and page view statistics.
// Run after `npm run build`: node tests/e2e/imports.mjs
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from './flags.mjs'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { strToU8, zipSync } from 'fflate'
import assert from 'assert'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-imports-'))

// A minimal Word document: a heading, bold text and a list.
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const docx = zipSync({
  '[Content_Types].xml': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Compte rendu</w:t></w:r></w:p>` +
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Décision importante</w:t></w:r></w:p>` +
      `</w:body></w:document>`
  )
})
writeFileSync(join(tmp, 'Réunion.docx'), docx)
writeFileSync(
  join(tmp, 'notes.md'),
  '# Notes Markdown\n\n- [lien](https://example.com)\n- *point*\n'
)
const pngHash = createHash('md5').update(PNG).digest('hex')
writeFileSync(
  join(tmp, 'carnet.enex'),
  `<?xml version="1.0" encoding="UTF-8"?><en-export>
  <note><title>Courses</title><content><![CDATA[<?xml version="1.0"?><en-note><div><en-todo checked="true"/>Pain</div><div><en-todo/>Lait</div><en-media hash="${pngHash}" type="image/png"/></en-note>]]></content>
  <resource><data encoding="base64">${PNG.toString('base64')}</data><mime>image/png</mime></resource></note>
  <note><title>Idées</title><content><![CDATA[<en-note><p>Une idée</p></en-note>]]></content></note>
</en-export>`
)
const page = (title, body) =>
  `<html><head><title>Wiki : ${title}</title></head><body><div id="title-text">Wiki : ${title}</div><div id="main-content">${body}</div></body></html>`
writeFileSync(
  join(tmp, 'confluence.zip'),
  zipSync({
    'WIKI/index.html': strToU8(
      `<ul><li><a href="Accueil_1.html">Accueil</a><ul><li><a href="Procedure_2.html">Procédure</a></li></ul></li></ul>`
    ),
    'WIKI/Accueil_1.html': strToU8(page('Accueil', '<p>Bienvenue</p>')),
    'WIKI/Procedure_2.html': strToU8(
      page('Procédure', '<p>Étapes</p><img src="attachments/2/schema.png">')
    ),
    'WIKI/attachments/2/schema.png': PNG
  })
)
writeFileSync(join(tmp, 'icone.png'), PNG)

const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(tmp, 'profile')}`]
})
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.locator('.blank').waitFor()

// Import the four kinds of files at once
await win
  .getByRole('button', { name: /Importer/ })
  .first()
  .click()
const chooser = win.waitForEvent('filechooser')
await win.getByRole('button', { name: 'Choisir des fichiers…' }).click()
await (
  await chooser
).setFiles(['Réunion.docx', 'notes.md', 'carnet.enex', 'confluence.zip'].map((f) => join(tmp, f)))
await win.locator('.import-report', { hasText: 'page(s) créée(s)' }).waitFor({ timeout: 20000 })
const report = await win.locator('.import-report').last().innerText()
assert.match(report, /8 page\(s\) créée\(s\), 2 image\(s\)/, report)

const pages = await win.evaluate(() => window.api.pages.list())
const byTitle = (t) => pages.find((p) => p.title === t)
for (const t of ['Compte rendu', 'Notes Markdown', 'carnet', 'Courses', 'Idées', 'confluence'])
  assert.ok(byTitle(t), `missing page ${t}`)
assert.equal(byTitle('Procédure').parentId, byTitle('Accueil').id)
assert.equal(byTitle('Courses').parentId, byTitle('carnet').id)
const courses = JSON.parse(
  (await win.evaluate((id) => window.api.pages.get(id), byTitle('Courses').id)).content
)
const kinds = JSON.stringify(courses)
assert.match(kinds, /"taskItem","attrs":\{"checked":true\}/)
assert.match(kinds, /"type":"image"/)
const word = (await win.evaluate((id) => window.api.pages.get(id), byTitle('Compte rendu').id))
  .content
assert.match(word, /"bold"/)
await win.keyboard.press('Escape')
await win
  .locator('.overlay')
  .click({ position: { x: 5, y: 5 } })
  .catch(() => {})

// Filtered search: titles only, then inside the Confluence import
await win.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p')
await win.locator('.dialog > input').fill('Bienvenue')
await win.locator('.hit', { hasText: 'Accueil' }).waitFor()
await win.locator('.search-filters button', { hasText: 'Titres seulement' }).click()
await win.locator('.dialog .empty').waitFor()
await win.locator('.search-filters button', { hasText: 'Titres seulement' }).click()
await win.locator('.search-filters select[aria-label="Dans"]').selectOption({ label: 'carnet' })
await win.locator('.dialog .empty').waitFor()
await win.locator('.search-filters select[aria-label="Dans"]').selectOption({ label: 'confluence' })
await win.locator('.hit', { hasText: 'Accueil' }).click()

// Image icon for the page, then its view statistics
await win.waitForFunction(() => {
  const t = document.querySelector('.page-title')
  return (t?.value ?? t?.textContent) === 'Accueil'
})
await win.locator('.page-head').hover()
await win.getByRole('button', { name: 'Ajouter une icône' }).click()
await win.locator('.page-icon').click()
const iconChooser = win.waitForEvent('filechooser')
await win.locator('.icon-picker').getByRole('button', { name: 'Image…' }).click()
await (await iconChooser).setFiles(join(tmp, 'icone.png'))
await win.locator('.page-head img.page-icon-image').waitFor()
await win.locator('.crumb-current img.page-icon-image').waitFor()
await win.getByTitle('Options de la page').click()
await win.locator('.page-stats-head', { hasText: '1 vue' }).waitFor()

await win.screenshot({ path: join(tmp, 'imports.png') })
assert.deepEqual(errors, [])
await app.close()
console.log(`OK imports e2e, screenshot: ${join(tmp, 'imports.png')}`)
