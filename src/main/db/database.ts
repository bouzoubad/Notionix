import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { app } from 'electron'

const MIGRATIONS: string[] = [
  `CREATE TABLE pages (
     id TEXT PRIMARY KEY,
     parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
     title TEXT NOT NULL DEFAULT '',
     icon TEXT,
     cover TEXT,
     content TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
     position REAL NOT NULL DEFAULT 0,
     favorite INTEGER NOT NULL DEFAULT 0,
     trashed_at INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     version INTEGER NOT NULL DEFAULT 1
   );
   CREATE INDEX pages_parent ON pages(parent_id, position);
   CREATE VIRTUAL TABLE page_fts USING fts5(id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');`,
  // Provenance of imported pages (e.g. 'notion:<32 hex id>'), so a re-import skips them.
  `ALTER TABLE pages ADD COLUMN source TEXT;
   CREATE UNIQUE INDEX pages_source ON pages(source) WHERE source IS NOT NULL;`
]

export function openDatabase(file = join(app.getPath('userData'), 'notionix.db')): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
