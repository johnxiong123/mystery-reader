import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from './db.js';

describe('db migrations', () => {
  let tempDir;
  let db;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-db-'));
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function config() {
    return {
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    };
  }

  it('全新数据库包含 furthest_chapter、word_count 与 bookmarks 表', () => {
    db = initDb(config());
    const progressCols = db.prepare("PRAGMA table_info(reading_progress)").all().map((c) => c.name);
    expect(progressCols).toContain('furthest_chapter');
    const chapterCols = db.prepare("PRAGMA table_info(chapters)").all().map((c) => c.name);
    expect(chapterCols).toContain('word_count');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    expect(tables).toContain('bookmarks');
  });

  it('旧库升级：补列并回填 furthest_chapter 与 word_count', () => {
    // 手工构造旧版 schema
    const raw = new Database(config().dbPath);
    raw.exec(`
      CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT,
        source_format TEXT, total_chapters INTEGER NOT NULL, import_status TEXT NOT NULL,
        analyzed_chapters INTEGER DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE chapters (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL,
        idx INTEGER NOT NULL, title TEXT, content TEXT NOT NULL,
        extract_status TEXT DEFAULT 'pending', UNIQUE(book_id, idx));
      CREATE TABLE reading_progress (book_id INTEGER PRIMARY KEY,
        current_chapter INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    `);
    raw.prepare(`INSERT INTO books (title, total_chapters, import_status, created_at)
      VALUES ('旧书', 2, 'done', ?)`).run(nowIso());
    raw.prepare(`INSERT INTO chapters (book_id, idx, title, content) VALUES (1, 0, '第一章', '十二个字的正文内容在此处')`).run();
    raw.prepare(`INSERT INTO reading_progress (book_id, current_chapter, updated_at) VALUES (1, 5, ?)`).run(nowIso());
    raw.close();

    db = initDb(config());

    const progress = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = 1').get();
    expect(progress.furthest_chapter).toBe(5); // 回填 = current
    const chapter = db.prepare('SELECT word_count, LENGTH(content) AS len FROM chapters WHERE book_id = 1').get();
    expect(chapter.word_count).toBe(chapter.len);
  });

  it('迁移幂等：initDb 可重复执行', () => {
    db = initDb(config());
    db.close();
    db = initDb(config());
    expect(db.prepare("PRAGMA table_info(reading_progress)").all().map((c) => c.name)).toContain('furthest_chapter');
  });
});
