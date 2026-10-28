const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'parent', 'instructor', 'admin')),
  grade_level   TEXT,
  school        TEXT,
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parent_students (
  parent_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (parent_id, student_id)
);

CREATE TABLE IF NOT EXISTS programs (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  start_date  TEXT,
  end_date    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id            INTEGER PRIMARY KEY,
  program_id    INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  schedule      TEXT,
  location      TEXT,
  capacity      INTEGER CHECK (capacity IS NULL OR capacity > 0),
  instructor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dropped', 'removed')),
  enrolled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ended_at    TEXT,
  end_reason  TEXT,
  UNIQUE (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY,
  thread_id    INTEGER,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  read_at      TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  sess    TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses(instructor_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, read_at);
`;

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'portal.db');

function openDatabase(file = process.env.DATABASE_FILE || DEFAULT_FILE) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Runs fn inside a transaction, rolling back if it throws.
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
