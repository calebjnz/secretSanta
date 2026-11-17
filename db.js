const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

function openDb(file = process.env.DB_FILE || path.join(__dirname, 'secretsanta.db')) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS families (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      code         TEXT NOT NULL UNIQUE,
      created_by   INTEGER NOT NULL REFERENCES users(id),
      allocated_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- many-to-many: a user can be in many families, a family has many users
    CREATE TABLE IF NOT EXISTS family_members (
      family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (family_id, user_id)
    );

    -- own ideas: suggested_by_id = for_user_id, family_id NULL
    -- secret suggestions: suggested_by_id != for_user_id, scoped to a family
    CREATE TABLE IF NOT EXISTS presents (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name       TEXT NOT NULL,
      for_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      suggested_by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family_id       INTEGER REFERENCES families(id) ON DELETE CASCADE,
      link            TEXT,
      cost            REAL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- giver_id buys a present for receiver_id within a family
    CREATE TABLE IF NOT EXISTS allocations (
      family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      giver_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (family_id, giver_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

module.exports = { openDb };
