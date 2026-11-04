import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { MAIN_WORKSPACE } from '../../src/shared/collab'
import { AssetStore } from '../../src/core/assets'
import { NotionClient } from '../../src/core/notion/client'
import { crawlNotion, fetchExtraFiles } from '../../src/core/notion/crawl'
import {
  MAIN,
  planMigration,
  type MigrationPlan,
  type TeamspaceInfo
} from '../../src/core/notion/plan'
import { Accounts } from './auth'
import { Workspaces } from './workspaces'

/**
 * Migration of a Notion workspace (« node main.mjs notion fetch|migrate »):
 * `fetch` reads Notion through an integration's token into a folder,
 * `migrate` writes it into Notionix: one workspace per Notion teamspace
 * (found by name, made when missing, with the teamspace's members), the pages
 * under it with Notion's ids, authors, dates, icons and files, the comments,
 * and Notion's custom emojis as the team's emojis. Pages an earlier import of
 * Notion exports made go to the trash. Running it again adds only what is new.
 */

export async function fetchNotion(
  tokenFile: string,
  dir: string,
  options: { blockComments: boolean }
): Promise<void> {
  const token = readFileSync(tokenFile, 'utf8').trim()
  if (!/^\S{20,}$/.test(token)) throw new Error(`Jeton Notion illisible dans ${tokenFile}.`)
  const client = new NotionClient({ token, log: (m) => console.log(m) })
  await crawlNotion(client, dir, {
    blockComments: options.blockComments,
    log: (m) => console.log(m)
  })
}

export interface MigrateOptions {
  dir: string
  teamspacesFile: string | null
  dryRun: boolean
  /** Moves the pages of earlier Notion imports to the trash */
  replaceImports: boolean
  timeZone?: string
  /** E-mail of the account the pages of no teamspace belong to (default: the token's creator) */
  owner?: string | null
  /**
   * Notion people of this e-mail domain without an account get one, disabled
   * (no sign-in until an administrator activates it), so that their pages,
   * mentions and « Person » values keep them
   */
  createAccountsFor?: string | null
  /** Only the pages of the teamspaces in the file; the others stay in Notion */
  onlyTeamspaces?: boolean
}

interface TeamspacesFile {
  teamspaces: TeamspaceInfo[]
  users?: { id: string; email: string | null; name: string | null }[]
}

export async function migrateNotion(
  db: DatabaseSync,
  dataDir: string,
  options: MigrateOptions
): Promise<{ plan: MigrationPlan; reportFile: string }> {
  const accounts = new Accounts(db, 30)
  const file: TeamspacesFile = options.teamspacesFile
    ? (JSON.parse(readFileSync(options.teamspacesFile, 'utf8')) as TeamspacesFile)
    : { teamspaces: [] }
  const teamspaces = file.teamspaces
  // Disabled accounts count: they are people of the team, kept as authors.
  const users: { id: string; email: string }[] = accounts
    .list()
    .map((u) => ({ id: u.id, email: u.email }))
  const createdAccounts: string[] = []
  if (options.createAccountsFor) {
    const domain = `@${options.createAccountsFor.toLowerCase().replace(/^@/, '')}`
    const fromApi = existsSync(join(options.dir, 'users.json'))
      ? (JSON.parse(readFileSync(join(options.dir, 'users.json'), 'utf8')) as {
          name?: string | null
          person?: { email?: string }
        }[])
      : []
    const people = new Map<string, string>()
    for (const p of [
      ...(file.users ?? []).map((u) => ({ email: u.email, name: u.name })),
      ...fromApi.map((u) => ({ email: u.person?.email ?? null, name: u.name ?? null }))
    ]) {
      const email = p.email?.trim().toLowerCase()
      if (!email?.endsWith(domain) || users.some((u) => u.email === email)) continue
      people.set(email, p.name?.trim() || email.split('@')[0])
    }
    for (const [email, name] of people) {
      if (options.dryRun) users.push({ id: `a-creer:${email}`, email })
      else {
        const user = await accounts.create({ email, name, role: 'editor', password: null })
        await accounts.update(user.id, { disabled: true })
        users.push({ id: user.id, email })
      }
      createdAccounts.push(`${name} <${email}>`)
    }
  }
  // Teamspace logos: links the API never gave, fetched now.
  const logos = teamspaces.map((t) => t.icon ?? '').filter((i) => /^https?:\/\//.test(i))
  if (logos.length) await fetchExtraFiles(options.dir, logos)
  // The owner of the private pages: given, or the creator of a personal token.
  const accountOf = (email: string | null | undefined): string | null =>
    (email && users.find((u) => u.email === email.toLowerCase())?.id) || null
  let owner = accountOf(options.owner)
  if (options.owner && !owner) throw new Error(`Aucun compte Notionix pour ${options.owner}.`)
  if (!owner) {
    const me = existsSync(join(options.dir, 'me.json'))
      ? (JSON.parse(readFileSync(join(options.dir, 'me.json'), 'utf8')) as {
          bot?: { owner?: { type?: string; user?: { id?: string; person?: { email?: string } } } }
        })
      : null
    const creator = me?.bot?.owner?.type === 'user' ? me.bot.owner.user : undefined
    owner = accountOf(
      creator?.person?.email ?? file.users?.find((u) => u.id === creator?.id)?.email
    )
  }
  // Files are stored first under the migration's folder, one store per target
  // workspace, then copied into the workspaces (same names: content addressed).
  const staging = join(options.dir, 'staging')
  const stores = new Map<string, AssetStore>()
  const store = (key: string): AssetStore => {
    if (!stores.has(key))
      stores.set(key, new AssetStore(join(staging, key.replace(/[^A-Za-z0-9-]/g, '_'))))
    return stores.get(key)!
  }
  const plan = await planMigration({
    dir: options.dir,
    teamspaces,
    notionUsers: file.users,
    owner,
    onlyTeamspaces: options.onlyTeamspaces,
    accounts: users,
    saveAsset: (workspace, bytes, name) => store(workspace).saveFile(bytes, name),
    timeZone: options.timeZone
  })

  const lines: string[] = []
  const summary: string[] = []
  const privateRoot = plan.nodes.find((n) => n.access === 'restricted' && n.parentId === null)
  if (privateRoot && !owner && !options.dryRun)
    throw new Error(
      'Des pages ne sont dans aucun espace d’équipe : indiquez à qui elles sont (--owner <e-mail>).'
    )
  if (!options.dryRun) {
    const registry = new Workspaces(db, dataDir)
    const ids = new Map<string, string>([[MAIN, MAIN_WORKSPACE]])
    for (const w of plan.workspaces) {
      const existing = registry.list().find((x) => x.name === w.name)
      if (existing) {
        const members = new Set([...(existing.memberIds ?? []), ...w.memberIds])
        registry.update(existing.id, {
          memberIds: [...members],
          ...(existing.icon ? {} : { icon: w.icon })
        })
        ids.set(w.key, existing.id)
        summary.push(`Espace « ${w.name} » : déjà là (${existing.id}), membres complétés.`)
      } else {
        const created = registry.create(w.name, w.icon, w.memberIds)
        ids.set(w.key, created.id)
        summary.push(`Espace « ${w.name} » créé (${created.id}).`)
      }
    }
    if (options.replaceImports) {
      const trashed = registry.main.pages.trashNotionImports()
      summary.push(
        `Ancien import de Notion mis à la corbeille : ${trashed.roots} page(s) de premier niveau, ${trashed.pages} page(s) en tout.`
      )
    }
    // Files, then pages, then comments, workspace by workspace.
    for (const [key, workspaceId] of ids) {
      const workspace = registry.get(workspaceId)!
      const from = join(staging, key.replace(/[^A-Za-z0-9-]/g, '_'))
      let copied = 0
      if (existsSync(from)) {
        const to = join(
          workspaceId === MAIN_WORKSPACE ? dataDir : join(dataDir, 'workspaces', workspaceId),
          'assets'
        )
        mkdirSync(to, { recursive: true })
        for (const name of readdirSync(from)) {
          if (existsSync(join(to, name))) continue
          copyFileSync(join(from, name), join(to, name))
          copied += 1
        }
      }
      const nodes = plan.nodes.filter((n) => (n.workspace === MAIN ? MAIN : n.workspace) === key)
      const { created, skipped } = workspace.pages.insertMigrated(nodes)
      let comments = 0
      for (const c of plan.comments.filter((c) => c.workspace === key))
        if (workspace.team.importComment(c)) comments += 1
      summary.push(
        `${key === MAIN ? 'Espace principal' : `« ${plan.workspaces.find((w) => w.key === key)?.name} »`} : ${created} page(s) créée(s), ${skipped} déjà là, ${comments} commentaire(s), ${copied} fichier(s).`
      )
    }
    const addEmoji = db.prepare(
      'INSERT OR IGNORE INTO custom_emojis (name, src, created_by, created_at) VALUES (?, ?, NULL, ?)'
    )
    let emojis = 0
    for (const e of plan.emojis)
      if (addEmoji.run(e.name, e.src, Date.now()).changes > 0) emojis += 1
    summary.push(
      `${emojis} émoji(s) de l’équipe ajouté(s) (${plan.emojis.length} venus de Notion).`
    )
    registry.close()
  }

  const r = plan.report
  lines.push(
    `# Migration Notion ${options.dryRun ? '(essai, rien n’est écrit)' : ''}`,
    '',
    `- ${r.pages} page(s), ${r.databases} base(s) et ${r.rows} ligne(s) de base, ${r.syncedBlocks} bloc(s) synchronisé(s)`,
    `- ${plan.comments.length} commentaire(s), ${plan.emojis.length} émoji(s) de l’équipe, ${r.files} fichier(s) gardé(s)`,
    ...(privateRoot
      ? [
          `- Pages hors espaces d’équipe : sous « ${privateRoot.title} », privée à ${owner ? users.find((u) => u.id === owner)?.email : 'PERSONNE (indiquer --owner)'}`
        ]
      : []),
    '',
    '## Espaces',
    ...plan.workspaces.map(
      (w) =>
        `- ${w.name} : ${plan.nodes.filter((n) => n.workspace === w.key).length} page(s), ${w.memberIds.length} membre(s)` +
        (w.missingMembers.length ? ` ; sans compte Notionix : ${w.missingMembers.join(', ')}` : '')
    ),
    `- Espace principal : ${plan.nodes.filter((n) => n.workspace === MAIN).length} page(s)`,
    ...(summary.length ? ['', '## Écrit', ...summary.map((s) => `- ${s}`)] : []),
    ...(createdAccounts.length
      ? [
          '',
          `## Comptes ${options.dryRun ? 'à créer' : 'créés'}, désactivés (${createdAccounts.length}) : à activer par Keeper le moment venu`,
          ...createdAccounts.map((a) => `- ${a}`)
        ]
      : []),
    ...(r.unassigned.length && options.onlyTeamspaces
      ? [
          '',
          `## Laissées dans Notion pour plus tard (${r.leftInNotion} page(s) sous ces pages de premier niveau)`,
          ...r.unassigned.map((t) => `- ${t}`)
        ]
      : []),
    ...(r.unassigned.length && !options.onlyTeamspaces
      ? [
          '',
          '## Pages hors espaces d’équipe (rangées dans l’espace principal)',
          ...r.unassigned.map((t) => `- ${t}`)
        ]
      : []),
    ...(r.orphans.length
      ? [
          '',
          '## Pages dont le parent n’est pas partagé avec l’intégration',
          ...r.orphans.map((t) => `- ${t}`)
        ]
      : []),
    ...(r.missingPeople.length
      ? ['', '## Personnes de Notion sans compte Notionix', ...r.missingPeople.map((t) => `- ${t}`)]
      : []),
    ...(Object.keys(r.notes).length
      ? ['', '## Non repris tel quel', ...Object.entries(r.notes).map(([k, v]) => `- ${k} : ${v}`)]
      : []),
    ...(r.filesMissing.length
      ? [
          '',
          `## Fichiers non récupérés (${r.filesMissing.length})`,
          ...r.filesMissing.slice(0, 200).map((t) => `- ${t}`)
        ]
      : []),
    ...(r.crawlWarnings.length
      ? [
          '',
          '## Parties de pages que Notion n’a pas données (page gardée)',
          ...r.crawlWarnings.map((w) => `- ${w}`)
        ]
      : []),
    ...(r.crawlErrors.length
      ? [
          '',
          '## Erreurs de lecture de Notion',
          ...r.crawlErrors.map((e) => `- ${e.id} : ${e.message}`)
        ]
      : [])
  )
  const reportFile = join(options.dir, options.dryRun ? 'rapport-essai.md' : 'rapport.md')
  writeFileSync(reportFile, `${lines.join('\n')}\n`)
  return { plan, reportFile }
}
