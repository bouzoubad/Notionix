import { DatabaseSync } from 'node:sqlite'

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
   CREATE UNIQUE INDEX pages_source ON pages(source) WHERE source IS NOT NULL;`,
  // Databases: a page of kind 'database' holds the schema; its child pages are rows.
  `ALTER TABLE pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page';
   ALTER TABLE pages ADD COLUMN db_schema TEXT;
   ALTER TABLE pages ADD COLUMN properties TEXT;
   ALTER TABLE pages ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;`,
  // Teams: authors, access and sharing, page options, history, comments,
  // notifications, activity, links between pages, reminders.
  `ALTER TABLE pages ADD COLUMN created_by TEXT;
   ALTER TABLE pages ADD COLUMN updated_by TEXT;
   ALTER TABLE pages ADD COLUMN access TEXT NOT NULL DEFAULT 'inherit';
   ALTER TABLE pages ADD COLUMN is_space INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE pages ADD COLUMN options TEXT;
   ALTER TABLE pages ADD COLUMN public_token TEXT;
   CREATE UNIQUE INDEX pages_public ON pages(public_token) WHERE public_token IS NOT NULL;
   CREATE TABLE page_shares (
     page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL,
     level TEXT NOT NULL,
     PRIMARY KEY (page_id, user_id)
   );
   CREATE TABLE page_versions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     content TEXT NOT NULL,
     authors TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX page_versions_page ON page_versions(page_id, created_at);
   CREATE TABLE comments (
     id TEXT PRIMARY KEY,
     page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     thread_id TEXT NOT NULL,
     author_id TEXT,
     body TEXT NOT NULL,
     mentions TEXT,
     quote TEXT,
     created_at INTEGER NOT NULL,
     edited_at INTEGER,
     resolved_at INTEGER
   );
   CREATE INDEX comments_page ON comments(page_id, created_at);
   CREATE TABLE notifications (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
     actor_id TEXT,
     text TEXT NOT NULL,
     ref TEXT,
     created_at INTEGER NOT NULL,
     read_at INTEGER
   );
   CREATE INDEX notifications_user ON notifications(user_id, created_at);
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
     actor_id TEXT,
     kind TEXT NOT NULL,
     detail TEXT,
     at INTEGER NOT NULL
   );
   CREATE INDEX activity_at ON activity(at);
   CREATE TABLE page_links (
     from_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     to_id TEXT NOT NULL,
     PRIMARY KEY (from_id, to_id)
   );
   CREATE INDEX page_links_to ON page_links(to_id);
   CREATE TABLE reminders (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     at INTEGER NOT NULL,
     text TEXT NOT NULL,
     sent_at INTEGER
   );
   CREATE INDEX reminders_due ON reminders(sent_at, at);`,
  // Who opened a page and when, for its view statistics.
  `CREATE TABLE page_views (
     page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE INDEX page_views_page ON page_views(page_id, at);`
]

/** Opens (and migrates) a workspace database: the app's local file or the server's shared one. */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
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
