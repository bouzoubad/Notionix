import { createInterface } from 'node:readline/promises'
import { join } from 'path'
import { Accounts, ROLES, type Role } from './auth'
import type { Config } from './config'
import { openDatabase } from './db'

const USAGE = `Commandes :
  create-user <email> <nom> <admin|editor|reader>   crée un compte (mot de passe demandé)
  reset-password <email>                              change le mot de passe d'un compte
  list-users                                          liste les comptes
  backup <fichier.db>                                 copie cohérente de la base (à chaud)`

async function askPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Mot de passe : ')
  rl.close()
  return answer
}

/** Administration commands, run inside the container: node dist/main.js <command>. */
export async function runCli(command: string, args: string[], config: Config): Promise<number> {
  const db = openDatabase(config.dataDir)
  const accounts = new Accounts(db, config.sessionDays)
  try {
    if (command === 'create-user' && args.length === 3 && ROLES.includes(args[2] as Role)) {
      const user = await accounts.create({ email: args[0], name: args[1], role: args[2] as Role, password: await askPassword() })
      console.log(`Compte créé : ${user.email} (${user.role})`)
    } else if (command === 'reset-password' && args.length === 1) {
      const user = accounts.list().find((u) => u.email === args[0].toLowerCase())
      if (!user) throw new Error('Compte introuvable.')
      await accounts.update(user.id, { password: await askPassword() })
      console.log('Mot de passe changé ; les sessions ouvertes sont fermées.')
    } else if (command === 'list-users') {
      for (const u of accounts.list()) console.log(`${u.email}\t${u.role}${u.disabled ? '\t(désactivé)' : ''}\t${u.name}`)
    } else if (command === 'backup' && args.length === 1) {
      const target = args[0].startsWith('/') ? args[0] : join(process.cwd(), args[0])
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
      console.log(`Sauvegarde écrite : ${target} (copiez aussi le dossier ${join(config.dataDir, 'assets')})`)
    } else {
      console.log(USAGE)
      return command === 'help' ? 0 : 1
    }
    return 0
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  } finally {
    db.close()
  }
}
