// Imports a real Notion export into a throwaway profile and prints the report, the page tree,
// the inferred database schemas and screenshots of chosen pages. Nothing touches your data.
// Usage: npm run build && SHOTS='Page A|Page B' node scripts/import-check.mjs path/to/export.zip
import { _electron as electron } from 'playwright-core'
import { CHROMIUM_FLAGS } from '../tests/e2e/flags.mjs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const zip = process.argv[2]
const out = mkdtempSync(join(tmpdir(), 'nx-real-'))
const app = await electron.launch({
  args: [...CHROMIUM_FLAGS, '.', `--user-data-dir=${join(out, 'profile')}`]
})
await app.evaluate(({ dialog }, p) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
}, zip)
const win = await app.firstWindow()
await win.getByRole('button', { name: 'Importer / Exporter' }).click()
await win.getByRole('button', { name: 'Choisir un export Notion…' }).click()
await win.locator('.import-report, .error').first().waitFor({ timeout: 120000 })
console.log(
  'REPORT',
  (await win.locator('.transfer-section').first().innerText()).split('\n').slice(-12).join(' / ')
)
await win.screenshot({ path: join(out, '0-report.png') })
const data = await win.evaluate(async () => {
  const pages = await window.api.pages.list()
  const byId = new Map(pages.map((p) => [p.id, p]))
  const depth = (p) => {
    let d = 0
    for (let q = p; q.parentId; q = byId.get(q.parentId)) d++
    return d
  }
  const tree = []
  const walk = (parent, d) =>
    pages
      .filter((p) => p.parentId === parent)
      .sort((a, b) => a.position - b.position)
      .forEach((p) => {
        tree.push(`${'  '.repeat(d)}${p.kind === 'database' ? '[DB] ' : ''}${p.title}`)
        if (d < 6) walk(p.id, d + 1)
      })
  walk(null, 0)
  const dbs = []
  for (const p of pages.filter((x) => x.kind === 'database')) {
    const d = await window.api.databases.get(p.id)
    dbs.push(
      `${p.title} (${d.rows.filter((r) => !r.isTemplate).length} lignes, ${d.rows.filter((r) => r.isTemplate).length} modèle(s)) : ` +
        d.schema.properties
          .map((x) => `${x.name}=${x.type}${x.options ? `[${x.options.length}]` : ''}`)
          .join(', ')
    )
  }
  return { count: pages.length, tree, dbs }
})
console.log('PAGES', data.count)
console.log(data.tree.join('\n'))
console.log('DATABASES\n' + data.dbs.join('\n'))
const shots = (process.env.SHOTS ?? 'Dev Corner|Troubleshooting and Support Hub')
  .split('|')
  .map((t, i) => [t, `shot-${i}`])
for (const [title, file] of shots) {
  const id = await win.evaluate(
    async (t) => (await window.api.pages.list()).find((p) => p.title === t)?.id,
    title
  )
  if (!id) {
    console.log('MISSING', title)
    continue
  }
  await win.evaluate((i) => localStorage.setItem('currentId', i), id)
  await win.reload()
  await win.waitForTimeout(1200)
  const types = await win.evaluate(async (i) => {
    const p = await window.api.pages.get(i)
    return p.kind === 'database'
      ? 'database'
      : JSON.parse(p.content)
          .content.map((n) => n.type)
          .join(',')
  }, id)
  console.log('PAGE', title, '=>', types.slice(0, 300))
  await win.screenshot({ path: join(out, `${file}.png`) })
}
console.log('OUT', out)
await app.close()
