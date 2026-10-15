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
   );`,
  // Feedback: bugs and ideas sent from the app, followed by the administrators.
  `CREATE TABLE feedback (
     id TEXT PRIMARY KEY,
     user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
     kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea')),
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     screenshot TEXT,
     context TEXT,
     status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'in_progress', 'done', 'declined')),
     reply TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX feedback_created ON feedback(created_at);`,
  // Groups of people, to share pages with a team at once; several workspaces.
  `CREATE TABLE groups (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE group_members (
     group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (group_id, user_id)
   );
   CREATE INDEX group_members_user ON group_members(user_id);
   CREATE TABLE workspaces (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     icon TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE workspace_members (
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     PRIMARY KEY (workspace_id, user_id)
   );
   INSERT INTO workspaces (id, name, icon, created_at) VALUES ('main', 'Espace principal', NULL, 0);`,
  // Activation links (shared through a password manager), provisional passwords,
  // archived workspaces and the administrators' audit log.
  `ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE activations (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX activations_user ON activations(user_id);
   ALTER TABLE workspaces ADD COLUMN archived_at INTEGER;
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     actor_id TEXT,
     action TEXT NOT NULL,
     target TEXT,
     detail TEXT,
     workspace TEXT
   );
   CREATE INDEX audit_at ON audit(at);`
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
