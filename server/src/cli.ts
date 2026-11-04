import { createInterface } from 'node:readline/promises'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { openWorkspace } from './workspace'
import { Accounts, ROLES, type Role } from './auth'
import type { Config } from './config'
import { openDatabase } from './db'
import { fetchNotion, migrateNotion } from './notionMigration'

const USAGE = `Commandes :
  create-user <email> <nom> <admin|editor|reader>   crée un compte (mot de passe demandé)
  reset-password <email>                              change le mot de passe d'un compte
  list-users                                          liste les comptes
  backup <dossier>                                    copie cohérente des bases (à chaud) dans un dossier
  notion-fetch <fichier-jeton> <dossier> [--block-comments]
                                                      lit Notion (intégration) dans un dossier
  notion-migrate <dossier> [--teamspaces <fichier>] [--dry-run] [--keep-imports] [--tz <fuseau>] [--owner <e-mail>]
                                                      écrit dans Notionix ce que notion-fetch a lu`

async function askPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Mot de passe : ')
  rl.close()
  return answer
}

/** Administration commands, run inside the container: node main.mjs <command>. */
export async function runCli(command: string, args: string[], config: Config): Promise<number> {
  const db = openDatabase(config.dataDir)
  const accounts = new Accounts(db, config.sessionDays)
  try {
    if (command === 'create-user' && args.length === 3 && ROLES.includes(args[2] as Role)) {
      const user = await accounts.create({
        email: args[0],
        name: args[1],
        role: args[2] as Role,
        password: await askPassword()
      })
      console.log(`Compte créé : ${user.email} (${user.role})`)
    } else if (command === 'reset-password' && args.length === 1) {
      const user = accounts.list().find((u) => u.email === args[0].toLowerCase())
      if (!user) throw new Error('Compte introuvable.')
      await accounts.update(user.id, { password: await askPassword() })
      console.log('Mot de passe changé ; les sessions ouvertes sont fermées.')
    } else if (command === 'list-users') {
      for (const u of accounts.list())
        console.log(`${u.email}\t${u.role}${u.disabled ? '\t(désactivé)' : ''}\t${u.name}`)
    } else if (command === 'backup' && args.length === 1) {
      const dir = args[0].startsWith('/') ? args[0] : join(process.cwd(), args[0])
      mkdirSync(dir, { recursive: true })
      const into = (source: DatabaseSync, file: string): void => {
        const target = join(dir, file)
        if (existsSync(target)) throw new Error(`Existe déjà : ${target}`)
        source.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
      }
      into(db, 'notionix-server.db')
      const workspace = openWorkspace(config.dataDir)
      try {
        into(workspace.db, 'workspace.db')
      } finally {
        workspace.db.close()
      }
      console.log(
        `Sauvegarde écrite dans ${dir} (copiez aussi le dossier ${join(config.dataDir, 'assets')})`
      )
    } else if (command === 'notion-fetch' && args.length >= 2) {
      await fetchNotion(args[0], absolute(args[1]), {
        blockComments: args.includes('--block-comments')
      })
    } else if (command === 'notion-migrate' && args.length >= 1) {
      const option = (name: string): string | null => {
        const i = args.indexOf(name)
        return i >= 0 && args[i + 1] ? args[i + 1] : null
      }
      const teamspaces = option('--teamspaces')
      const { reportFile } = await migrateNotion(db, config.dataDir, {
        dir: absolute(args[0]),
        teamspacesFile: teamspaces ? absolute(teamspaces) : null,
        dryRun: args.includes('--dry-run'),
        replaceImports: !args.includes('--keep-imports'),
        timeZone: option('--tz') ?? undefined,
        owner: option('--owner')
      })
      console.log(readFileSync(reportFile, 'utf8'))
      console.log(`Rapport : ${reportFile}`)
    } else {
      console.log(USAGE)
      return command === 'help' ? 0 : 1
    }
    return 0
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    if (process.env.NOTIONIX_DEBUG) console.error(e)
    return 1
  } finally {
    db.close()
  }
}

const absolute = (path: string): string => (path.startsWith('/') ? path : join(process.cwd(), path))
