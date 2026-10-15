// E2E of the web client against a real server: account created with a key to
// share (activation link), activation, groups, sharing, inbox, workspaces,
// live editing between two people, and the administrators' dashboard.
// Run after `npm run build:server && npm run build:web`: node tests/e2e/web.mjs
import { _electron as electron } from 'playwright-core'
import { spawn } from 'child_process'
import { mkdtempSync } from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'
import { CHROMIUM_FLAGS } from './flags.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'notionix-e2e-web-'))
const ADMIN = { email: 'admin@example.com', password: 'motdepasse-admin' }
const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const url = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['out/server/main.mjs'], {
  env: {
    ...process.env,
    NOTIONIX_PORT: String(port),
    NOTIONIX_DATA_DIR: join(tmp, 'data'),
    NOTIONIX_WEB_DIR: join(process.cwd(), 'out/server/web'),
    NOTIONIX_ADMIN_EMAIL: ADMIN.email,
    NOTIONIX_ADMIN_PASSWORD: ADMIN.password
  },
  stdio: ['ignore', 'pipe', 'inherit']
})
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('écoute') && resolve())
  server.on('exit', (code) => reject(new Error(`server exited ${code}`)))
})

const browsers = []
const open = async (name) => {
  const app = await electron.launch({
    args: [...CHROMIUM_FLAGS, 'tests/e2e/web-host/main.cjs', `--user-data-dir=${join(tmp, name)}`],
    env: { ...process.env, NOTIONIX_URL: url }
  })
  browsers.push(app)
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))
  return { win, errors }
}
const cleanup = async () => {
  for (const b of browsers) await b.close().catch(() => {})
  server.kill()
}

try {
  // The administrator signs in
  const { win: admin, errors: adminErrors } = await open('admin')
  await admin.getByLabel('E-mail').fill(ADMIN.email)
  await admin.getByLabel('Mot de passe').fill(ADMIN.password)
  await admin.getByRole('button', { name: 'Se connecter' }).click()
  await admin.locator('.sidebar').waitFor()

  // Creates Bob's account: the key to share through Keeper is an activation link
  await admin.getByRole('button', { name: 'Administration' }).click()
  await admin.locator('.admin-cards').waitFor()
  await admin.getByRole('button', { name: 'Comptes de l’équipe' }).click()
  await admin.getByPlaceholder('Prénom Nom').fill('Bob Martin')
  await admin.getByPlaceholder('e-mail').fill('bob@example.com')
  await admin.getByRole('button', { name: 'Créer', exact: true }).click()
  const link = await admin
    .locator('.keeper-field', { hasText: 'Lien d’activation' })
    .locator('code')
    .innerText()
  assert.match(link, new RegExp(`^${url}/activate/[A-Za-z0-9_-]+$`))
  await admin.getByRole('button', { name: 'C’est partagé' }).click()
  await admin.locator('td', { hasText: 'à activer' }).waitFor()

  // A group with Bob, and a workspace for him
  await admin.getByRole('button', { name: 'Groupes' }).click()
  await admin.getByPlaceholder('Nom du groupe').fill('Équipe produit')
  await admin.getByRole('button', { name: 'Créer le groupe' }).click()
  await admin.locator('.member-picker label', { hasText: 'Bob Martin' }).click()
  await admin.locator('.member-picker label.active', { hasText: 'Bob Martin' }).waitFor()
  await admin.getByRole('button', { name: 'Espaces de travail' }).click()
  await admin.getByPlaceholder('Nom de l’espace').fill('Projet X')
  await admin.getByRole('button', { name: 'Créer l’espace' }).click()
  const projet = admin.locator('.team-item', { has: admin.locator('input[value="Projet X"]') })
  await projet.locator('.member-picker label', { hasText: 'Bob Martin' }).click()
  await projet.locator('.member-picker label.active').waitFor()
  await admin.keyboard.press('Escape')
  await admin.locator('.overlay').click({ position: { x: 5, y: 5 } })

  // A private page, shared with the group
  await admin.getByRole('button', { name: '+ Nouvelle page' }).click()
  await admin.locator('.page-title').fill('Feuille de route')
  await admin.locator('.page-title').press('Enter')
  await admin.keyboard.type('Première étape')
  await admin.getByRole('button', { name: /Partager/ }).click()
  await admin.locator('.share-menu select').first().selectOption('restricted')
  await admin
    .locator('.share-invite select')
    .first()
    .selectOption({ label: 'Équipe produit (1 personne)' })
  await admin.locator('.share-invite').getByRole('button', { name: 'Inviter' }).click()
  await admin.locator('.share-list li', { hasText: 'Équipe produit' }).waitFor()
  await admin.keyboard.press('Escape')

  // Bob opens the link, chooses his password and lands in the app
  const { win: bob, errors: bobErrors } = await open('bob')
  await bob.goto(link)
  await bob.locator('text=Bienvenue Bob Martin').waitFor()
  await bob.getByLabel(/^Mot de passe \(/).fill('mot-de-passe-de-bob')
  await bob.getByLabel('Mot de passe, à nouveau').fill('mot-de-passe-de-bob')
  await bob.getByRole('button', { name: 'Activer mon compte' }).click()
  await bob.locator('.sidebar').waitFor()

  // The page shared with his group is there, with a notification
  await bob.locator('.sidebar .row', { hasText: 'Feuille de route' }).click()
  await bob.locator('.ProseMirror', { hasText: 'Première étape' }).waitFor()
  await bob.getByRole('button', { name: /Boîte de réception/ }).click()
  await bob.locator('.inbox-item', { hasText: 'a partagé' }).waitFor()
  await bob.keyboard.press('Escape')
  await bob
    .locator('.overlay')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {})

  // Live editing: what Bob types appears for the administrator
  await bob.locator('.page-body .ProseMirror').click()
  await bob.keyboard.press('End')
  await bob.keyboard.type(' — relu par Bob')
  await admin.locator('.ProseMirror', { hasText: 'relu par Bob' }).waitFor()

  // Bob switches to his other workspace and works there
  await bob.locator('.workspace-current').click()
  await bob.locator('.workspace-menu .menu-item', { hasText: 'Projet X' }).click()
  await bob.locator('.workspace-current', { hasText: 'Projet X' }).waitFor()
  assert.equal(await bob.locator('.sidebar .row', { hasText: 'Feuille de route' }).count(), 0)
  await bob.getByRole('button', { name: '+ Nouvelle page' }).click()
  await bob.locator('.page-title').fill('Plan du projet')
  await bob.locator('.page-title').press('Enter')
  await bob.waitForFunction(() => location.hash.startsWith('#/page/'))
  await bob.locator('.sidebar .row', { hasText: 'Plan du projet' }).waitFor()
  const planLink = await bob.evaluate(() => location.href)

  // A link to that page, opened by the administrator from the main workspace, switches workspace
  await admin.goto(planLink)
  await admin.locator('.workspace-current', { hasText: 'Projet X' }).waitFor()
  await admin.waitForFunction(
    () => document.querySelector('.page-title')?.value === 'Plan du projet'
  )

  // The dashboard and the audit log tell what happened
  await admin.getByRole('button', { name: 'Administration' }).click()
  await admin
    .locator('.admin-card', { hasText: 'comptes actifs' })
    .locator('strong', { hasText: '2' })
    .waitFor()
  await admin.locator('.audit-table td', { hasText: 'Compte activé' }).waitFor()
  await admin.locator('.audit-table td', { hasText: 'Partage d’une page' }).waitFor()
  await admin.screenshot({ path: join(tmp, 'web-admin.png') })

  assert.deepEqual(adminErrors, [])
  assert.deepEqual(bobErrors, [])
  console.log(`OK web e2e, screenshot: ${join(tmp, 'web-admin.png')}`)
} finally {
  await cleanup()
}
