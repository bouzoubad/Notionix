import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { join } from 'path'

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reader')),
     password_hash TEXT NOT NULL,
     disabled INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE documents (
     name TEXT PRIMARY KEY,
     state BLOB NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  // Guests (only the pages shared with them) and API tokens. SQLite cannot
  // change a CHECK constraint: the users table is rebuilt.
  `CREATE TABLE users_next (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reader', 'guest')),
     password_hash TEXT NOT NULL,
     disabled INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   INSERT INTO users_next SELECT id, email, name, role, password_hash, disabled, created_at FROM users;
   DROP TABLE users;
   ALTER TABLE users_next RENAME TO users;
   CREATE TABLE api_tokens (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     last_used_at INTEGER
   );`
]

export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'notionix-server.db'))
  // Foreign keys are checked after the migrations: rebuilding a table must not cascade.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;')
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
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
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}
