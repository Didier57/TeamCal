import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const migrations: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  language TEXT NOT NULL DEFAULT 'fr',
  timezone TEXT,
  date_format TEXT,
  time_format TEXT,
  default_view TEXT NOT NULL DEFAULT 'week',
  theme TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2f6feb',
  created_at TEXT NOT NULL
);

CREATE TABLE calendar_acl (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_create INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (calendar_id, user_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  location TEXT,
  url TEXT,
  priority INTEGER,
  visibility TEXT NOT NULL DEFAULT 'default',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  rrule TEXT,
  recurrence_until TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_events_calendar ON events(calendar_id, start_at);
CREATE INDEX idx_events_owner ON events(owner_id, start_at);
CREATE UNIQUE INDEX idx_events_uid ON events(uid);

CREATE TABLE event_participants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE event_exceptions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_start TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'modified',
  override_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, occurrence_start)
);

CREATE TABLE custom_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE custom_view_users (
  view_id TEXT NOT NULL REFERENCES custom_views(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (view_id, user_id)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TABLE email_log (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  event_id TEXT,
  created_at TEXT NOT NULL
);
`
  },
  {
    id: 2,
    sql: `ALTER TABLE users ADD COLUMN theme_colors TEXT;`
  },
  {
    id: 3,
    sql: `
ALTER TABLE users ADD COLUMN feed_token TEXT;
CREATE UNIQUE INDEX idx_users_feed_token ON users(feed_token) WHERE feed_token IS NOT NULL;
`
  },
  {
    id: 4,
    sql: `
ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE events ADD COLUMN holiday_source_id TEXT;
ALTER TABLE events ADD COLUMN holiday_key TEXT;
CREATE UNIQUE INDEX idx_events_holiday_key ON events(calendar_id, holiday_key) WHERE holiday_key IS NOT NULL;
`
  },
  {
    id: 5,
    sql: `
CREATE TABLE holiday_adjustments (
  holiday_key TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  title TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_holiday_adjustments_country ON holiday_adjustments(country);
`
  },
  {
    id: 6,
    sql: `
ALTER TABLE events ADD COLUMN deleted_at TEXT;
ALTER TABLE events ADD COLUMN deleted_by TEXT;
`
  },
  {
    id: 7,
    sql: `ALTER TABLE events ADD COLUMN rdates TEXT;`
  },
  {
    id: 8,
    sql: `ALTER TABLE categories ADD COLUMN is_holiday INTEGER NOT NULL DEFAULT 0;`
  },
  {
    id: 9,
    sql: `
ALTER TABLE users ADD COLUMN password_token TEXT;
ALTER TABLE users ADD COLUMN password_token_expires_at TEXT;
`
  }
];

export function openDatabase(databasePath: string): DB {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

export function runMigrations(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: number }).id)
  );
  const insert = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.id, new Date().toISOString());
    })();
  }
}
