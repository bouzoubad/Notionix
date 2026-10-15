import shared from './shared'
import database from './database'
import editor from './editor'
import components from './components'
import web from './web'
import main from './main'
import server from './server'

/** English, keyed by the French source texts (see ../../i18n.ts). */
const en: Record<string, string> = {
  ...shared,
  ...database,
  ...editor,
  ...components,
  ...web,
  ...main,
  ...server
}
export default en
