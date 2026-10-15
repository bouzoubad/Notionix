import { readConfig } from './config'
import { startServer } from './server'
import { runCli } from './cli'

const [command, ...args] = process.argv.slice(2)
if (command) {
  process.exitCode = await runCli(command, args, readConfig())
} else {
  const config = readConfig()
  const running = await startServer(config)
  console.log(
    `Notionix à l’écoute sur ${config.host}:${config.port} (données : ${config.dataDir}, application web : ${config.webDir ?? 'aucune'})`
  )
  let stopping = false
  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    await running.stop()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
