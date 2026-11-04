import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DatabaseSync } from 'node:sqlite'
import { MAIN_WORKSPACE } from '../../src/shared/collab'
import { AssetStore } from '../../src/core/assets'
import { NotionClient } from '../../src/core/notion/client'
import { crawlNotion } from '../../src/core/notion/crawl'
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
  if (!/^(ntn_|secret_)\S+$/.test(token))
    throw new Error(`Jeton Notion illisible dans ${tokenFile}.`)
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
}

export async function migrateNotion(
  db: DatabaseSync,
  dataDir: string,
  options: MigrateOptions
): Promise<{ plan: MigrationPlan; reportFile: string }> {
  const accounts = new Accounts(db, 30)
  const users = accounts.list().filter((u) => !u.disabled)
  const teamspaces: TeamspaceInfo[] = options.teamspacesFile
    ? (JSON.parse(readFileSync(options.teamspacesFile, 'utf8')) as { teamspaces: TeamspaceInfo[] })
        .teamspaces
    : []
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
    accounts: users.map((u) => ({ id: u.id, email: u.email })),
    saveAsset: (workspace, bytes, name) => store(workspace).saveFile(bytes, name),
    timeZone: options.timeZone
  })

  const lines: string[] = []
  const summary: string[] = []
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
    '',
    '## Espaces',
    ...plan.workspaces.map(
      (w) =>
        `- ${w.name} : ${plan.nodes.filter((n) => n.workspace === w.key).length} page(s), ${w.memberIds.length} membre(s)` +
        (w.missingMembers.length ? ` ; sans compte Notionix : ${w.missingMembers.join(', ')}` : '')
    ),
    `- Espace principal : ${plan.nodes.filter((n) => n.workspace === MAIN).length} page(s)`,
    ...(summary.length ? ['', '## Écrit', ...summary.map((s) => `- ${s}`)] : []),
    ...(r.unassigned.length
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
