import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { installErrorHandler } from '../errors.js';
import { deleteBookData, registerBookRoutes } from './books.js';

describe('book deletion', () => {
  let tempDir;
  let db;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-delete-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('删除书籍时清理所有本地关联数据', () => {
    const bookId = seedFullBook(db);

    const deleted = deleteBookData(db, bookId);

    expect(deleted).toBe(true);
    for (const table of ['books', 'chapters', 'characters', 'relationships', 'events', 'reading_progress']) {
      expect(countRows(db, table, bookId)).toBe(0);
    }
  });

  it('删除不存在的书籍时返回 false', () => {
    expect(deleteBookData(db, 999)).toBe(false);
  });
});

describe('book import without API key', () => {
  let tempDir;
  let db;
  let app;
  let extractor;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-import-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    extractor = { extractBook: vi.fn() };
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await app.register(multipart, { limits: { fileSize: 1024 * 1024, files: 1 } });
    await registerBookRoutes(app, {
      db,
      config: { uploadDir: path.join(tempDir, 'uploads'), ai: { apiKey: '', configured: false } },
      extractor,
      settingsStore: {
        getAiSettings: () => ({ configured: false, apiKey: '', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('允许导入章节但不触发 AI 抽取', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/books/import',
      headers: multipartHeaders('boundary'),
      payload: multipartBody('boundary', 'sample.txt', [
        '第一章 雨夜',
        '',
        '林砚推开旧书店的门。',
        '',
        '第二章 名单',
        '',
        '名单上有三个陌生名字。'
      ].join('\n'))
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.status).toBe('pending_config');
    expect(extractor.extractBook).not.toHaveBeenCalled();

    const book = db.prepare('SELECT import_status, total_chapters, analyzed_chapters FROM books WHERE id = ?').get(payload.bookId);
    expect(book).toEqual({
      import_status: 'pending_config',
      total_chapters: 2,
      analyzed_chapters: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE book_id = ?').get(payload.bookId).count).toBe(2);
  });

  it('导入时为每章写入 word_count', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/books/import',
      headers: multipartHeaders('boundary'),
      payload: multipartBody('boundary', 'sample.txt', [
        '第一章 雨夜', '', '林砚推开旧书店的门。', '', '第二章 名单', '', '名单上有三个陌生名字。'
      ].join('\n'))
    });
    const payload = JSON.parse(response.body);
    const rows = db.prepare('SELECT word_count, LENGTH(content) AS len FROM chapters WHERE book_id = ?').all(payload.bookId);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.word_count).toBe(row.len);
  });
});

function seedFullBook(db) {
  const bookId = Number(db.prepare(`
    INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
    VALUES ('测试书', null, 'txt', 1, 'done', 1, ?)
  `).run(nowIso()).lastInsertRowid);
  db.prepare(`
    INSERT INTO chapters (book_id, idx, title, content, extract_status)
    VALUES (?, 0, '第一章', '正文', 'done')
  `).run(bookId);
  const charA = Number(db.prepare(`
    INSERT INTO characters (book_id, name, aliases, identity, first_seen_chapter)
    VALUES (?, '林砚', '[]', '记者', 0)
  `).run(bookId).lastInsertRowid);
  const charB = Number(db.prepare(`
    INSERT INTO characters (book_id, name, aliases, identity, first_seen_chapter)
    VALUES (?, '周屿', '[]', '酒吧老板', 0)
  `).run(bookId).lastInsertRowid);
  db.prepare(`
    INSERT INTO relationships (book_id, from_char_id, to_char_id, type, reveal_chapter, description)
    VALUES (?, ?, ?, '调查', 0, '林砚调查周屿')
  `).run(bookId, charA, charB);
  db.prepare(`
    INSERT INTO events (book_id, description, occur_chapter, reveal_chapter, involved_char_ids)
    VALUES (?, '林砚收到匿名信', 0, 0, ?)
  `).run(bookId, JSON.stringify([charA]));
  db.prepare(`
    INSERT INTO reading_progress (book_id, current_chapter, updated_at)
    VALUES (?, 0, ?)
  `).run(bookId, nowIso());
  return bookId;
}

function countRows(db, table, bookId) {
  const column = table === 'books' ? 'id' : 'book_id';
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(bookId).count;
}

function multipartHeaders(boundary) {
  return { 'content-type': `multipart/form-data; boundary=${boundary}` };
}

function multipartBody(boundary, filename, content) {
  return Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: text/plain',
    '',
    content,
    `--${boundary}--`,
    ''
  ].join('\r\n'));
}
