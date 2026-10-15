import type { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { openDatabase } from '../../src/core/db/database'
import { PageRepository } from '../../src/core/db/pageRepository'
import { DatabaseRepository } from '../../src/core/db/databaseRepository'
import { AssetStore } from '../../src/core/assets'
import { TeamRepository } from '../../src/core/db/teamRepository'

/**
 * The shared workspace: the same pages, databases and images as in the app,
 * stored by the same code. A copy of the app's notionix.db works here as is.
 */
export interface Workspace {
  db: DatabaseSync
  pages: PageRepository
  databases: DatabaseRepository
  assets: AssetStore
  team: TeamRepository
}

export function openWorkspace(dataDir: string): Workspace {
  const db = openDatabase(join(dataDir, 'workspace.db'))
  const pages = new PageRepository(db)
  return {
    db,
    pages,
    databases: new DatabaseRepository(pages),
    assets: new AssetStore(join(dataDir, 'assets')),
    team: new TeamRepository(db)
  }
}
