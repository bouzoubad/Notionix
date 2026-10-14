// Regenerate docs/screenshots/*.png from the built app: npm run build && node scripts/screenshots.mjs
import { _electron as electron } from 'playwright-core'
import { strToU8, zipSync } from 'fflate'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'docs', 'screenshots')

const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) })
const p = (...c) => ({ type: 'paragraph', content: c })
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const li = (t) => ({ type: 'listItem', content: [p(text(t))] })
const task = (t, checked) => ({ type: 'taskItem', attrs: { checked }, content: [p(text(t))] })
const doc = (...content) => JSON.stringify({ type: 'doc', content })

const welcome = doc(
  p(
    text(
      'Notionix est un espace de travail local : pages imbriquées, éditeur de blocs et recherche instantanée.'
    )
  ),
  h(2, 'Premiers pas'),
  {
    type: 'taskList',
    content: [
      task('Créer une première page', true),
      task('Organiser ses pages par glisser-déposer', true),
      task('Essayer le menu « / » pour insérer des blocs', false),
      task('Retrouver une page avec Cmd+K', false)
    ]
  },
  h(2, 'Idées'),
  {
    type: 'bulletList',
    content: [
      li('Bases de données avec vues table et board'),
      li('Templates de pages'),
      li('Synchronisation (plus tard)')
    ]
  },
  {
    type: 'callout',
    attrs: { icon: '💡' },
    content: [p(text('Tout reste sur votre ordinateur : aucun compte, aucune connexion.'))]
  },
  {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: ['Bloc', 'Statut'].map((t) => ({ type: 'tableHeader', content: [p(text(t))] }))
      },
      {
        type: 'tableRow',
        content: ['Tableaux et images', 'Disponible'].map((t) => ({
          type: 'tableCell',
          content: [p(text(t))]
        }))
      },
      {
        type: 'tableRow',
        content: ['Bases de données', 'Phase 3'].map((t) => ({
          type: 'tableCell',
          content: [p(text(t))]
        }))
      }
    ]
  },
  {
    type: 'details',
    content: [
      { type: 'detailsSummary', content: [text('Pourquoi Notionix ?')] },
      { type: 'detailsContent', content: [p(text('Vos idées. Un seul espace.'))] }
    ]
  },
  h(3, 'Un peu de code'),
  {
    type: 'codeBlock',
    attrs: { language: 'ts' },
    content: [text("const pages = await window.api.pages.search('roadmap')")]
  }
)
const roadmap = doc(p(text('Objectifs du trimestre.')), h(2, 'Phase 2'), {
  type: 'bulletList',
  content: [li('Callouts, toggles et tableaux'), li('Menu de formatage flottant')]
})

const app = await electron.launch({
  cwd: root,
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nx-shots-'))}`]
})
const win = await app.firstWindow()
await win.setViewportSize?.({ width: 1280, height: 820 })
await win.waitForSelector('.blank')

const ids = await win.evaluate(
  async ({ welcome, roadmap }) => {
    const api = window.api.pages
    const mk = async (parent, title, icon, content, favorite = false, cover = null) => {
      const page = await api.create(parent)
      await api.update(page.id, { title, icon, favorite, cover, ...(content ? { content } : {}) })
      return page.id
    }
    const home = await mk(null, 'Bienvenue', '👋', welcome, true, 'gradient:3')
    const projets = await mk(null, 'Projets', '🚀')
    const road = await mk(projets, 'Feuille de route', '🗺️', roadmap)
    await mk(projets, 'Notes de réunion', '📝')
    await mk(null, 'Journal', '📓')
    await mk(null, 'Lectures', '📚')
    localStorage.setItem('currentId', home)
    localStorage.setItem('expanded', JSON.stringify({ [projets]: true }))
    return { home, road }
  },
  { welcome, roadmap }
)

await win.reload()
await win.waitForSelector('.editor h2')
await win.emulateMedia({ colorScheme: 'light' })
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, 'editor-light.png') })

await win.emulateMedia({ colorScheme: 'dark' })
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, 'editor-dark.png') })

await win.emulateMedia({ colorScheme: 'light' })
await win.keyboard.press('Meta+k')
await win.locator('.dialog input').fill('callout')
await win.locator('.hit mark').first().waitFor()
await win.waitForTimeout(200)
await win.screenshot({ path: join(out, 'search.png') })
await win.keyboard.press('Escape')

await win.locator('.row', { hasText: 'Notes de réunion' }).click()
await win.locator('.page-title').waitFor()
await win.locator('.editor .ProseMirror').click()
await win.keyboard.type('Ordre du jour')
await win.keyboard.press('Enter')
await win.keyboard.type('/')
await win.locator('.slash-menu').waitFor()
await win.waitForTimeout(200)
await win.screenshot({ path: join(out, 'slash-menu.png') })
await app.close()

// Notion import, on a fresh profile so only imported pages show: a small, realistic "Markdown & CSV" export built on the fly.
const id = (c) => c.repeat(32)
const notionExport = {
  [`Roadmap produit ${id('a')}.md`]: `# Roadmap produit

Notre plan pour les prochains mois. Détails des chantiers : [Idées](Roadmap%20produit%20${id('a')}/Id%C3%A9es%20${id('b')}.md).

## Cette semaine

- [x] Exporter l'espace de travail depuis Notion
- [x] Importer l'export dans Notionix
- [ ] Vérifier les liens entre pages

<aside>
💡 Les bases de données (propriétés et vues) arrivent avec la phase 3.
</aside>

<details>
<summary>Pourquoi un outil local ?</summary>

Les données restent sur l'ordinateur, sans compte ni connexion.

</details>

| Chantier | Statut |
| --- | --- |
| Import Notion | Terminé |
| Bases de données | À venir |

![capture](Roadmap%20produit%20${id('a')}/capture.png)
`,
  [`Roadmap produit ${id('a')}/Idées ${id('b')}.md`]:
    '# Idées\n\n- Vues table et board\n- Templates de pages\n- Synchronisation\n',
  [`Roadmap produit ${id('a')}/Notes de réunion ${id('c')}.md`]:
    '# Notes de réunion\n\nOrdre du jour : migration depuis Notion.\n',
  [`Roadmap produit ${id('a')}/capture.png`]: readFileSync(
    join(root, 'docs', 'brand', 'notionix-light.png')
  ),
  [`Tâches ${id('d')}_all.csv`]: 'Nom,Statut\nÉcrire la doc,En cours\n',
  [`Tâches ${id('d')}/Écrire la doc ${id('e')}.md`]:
    '# Écrire la doc\n\nStatut: En cours\n\nRédiger le guide de migration.\n',
  [`Tâches ${id('d')}/Corriger le bug ${id('f')}.md`]: '# Corriger le bug\n\nStatut: Terminé\n'
}
const exportZip = join(tmpdir(), `nx-notion-export-${Date.now()}.zip`)
writeFileSync(
  exportZip,
  zipSync(
    Object.fromEntries(
      Object.entries(notionExport).map(([k, v]) => [
        k,
        typeof v === 'string' ? strToU8(v) : new Uint8Array(v)
      ])
    )
  )
)
const importApp = await electron.launch({
  cwd: root,
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nx-shots-import-'))}`]
})
const importWin = await importApp.firstWindow()
await importWin.waitForSelector('.blank')
await importApp.evaluate(({ dialog }, zip) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [zip] })
}, exportZip)

await importWin.emulateMedia({ colorScheme: 'light' })
await importWin.getByRole('button', { name: 'Importer / Exporter' }).click()
await importWin.getByRole('button', { name: 'Choisir un export Notion…' }).click()
await importWin.locator('.import-report').waitFor()
await importWin.waitForTimeout(200)
await importWin.screenshot({ path: join(out, 'import-notion.png') })

await importWin.getByRole('button', { name: 'Ouvrir les pages importées' }).click()
await importWin.locator('.row', { hasText: 'Importé de Notion' }).locator('.chevron').click()
await importWin.locator('.row', { hasText: 'Roadmap produit' }).locator('.chevron').click()
await importWin.locator('.row', { hasText: 'Roadmap produit' }).click()
await importWin.locator('.editor aside.callout').first().waitFor()
await importWin.waitForTimeout(300)
await importWin.screenshot({ path: join(out, 'imported-notion.png') })
await importApp.close()
console.log('screenshots written to', out)
