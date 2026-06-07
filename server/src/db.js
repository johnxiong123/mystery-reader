import fs from 'node:fs';
import Database from 'better-sqlite3';

let db;

export function initDb(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      source_format TEXT,
      total_chapters INTEGER NOT NULL,
      import_status TEXT NOT NULL,
      analyzed_chapters INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      extract_status TEXT DEFAULT 'pending',
      UNIQUE(book_id, idx)
    );
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      aliases TEXT,
      identity TEXT,
      first_seen_chapter INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      from_char_id INTEGER NOT NULL,
      to_char_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      reveal_chapter INTEGER NOT NULL,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      occur_chapter INTEGER NOT NULL,
      reveal_chapter INTEGER NOT NULL,
      involved_char_ids TEXT
    );
    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id INTEGER PRIMARY KEY,
      current_chapter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  repairImportStatuses(db);

  return db;
}

export function getDb() {
  if (!db) throw new Error('数据库尚未初始化。');
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

function repairImportStatuses(database) {
  database.exec(`
    UPDATE books
    SET import_status = 'error'
    WHERE import_status = 'done'
      AND EXISTS (
        SELECT 1
        FROM chapters
        WHERE chapters.book_id = books.id
          AND chapters.extract_status = 'error'
      );

    UPDATE books
    SET import_status = 'done'
    WHERE import_status = 'error'
      AND total_chapters > 0
      AND analyzed_chapters >= total_chapters
      AND NOT EXISTS (
        SELECT 1
        FROM chapters
        WHERE chapters.book_id = books.id
          AND chapters.extract_status != 'done'
      );
  `);
}
