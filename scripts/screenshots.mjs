// Regenerate docs/screenshots/*.png from the built app: npm run build && node scripts/screenshots.mjs
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
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
  { type: 'blockquote', content: [p(text('Vos idées. Un seul espace.'))] },
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
    const mk = async (parent, title, icon, content, favorite = false) => {
      const page = await api.create(parent)
      await api.update(page.id, { title, icon, favorite, ...(content ? { content } : {}) })
      return page.id
    }
    const home = await mk(null, 'Bienvenue', '👋', welcome, true)
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
console.log('screenshots written to', out)
