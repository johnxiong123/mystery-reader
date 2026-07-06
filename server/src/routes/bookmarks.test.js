import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { installErrorHandler } from '../errors.js';
import { registerBookmarkRoutes } from './bookmarks.js';
import { deleteBookData } from './books.js';

describe('bookmarks', () => {
  let tempDir;
  let db;
  let app;
  let bookId;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-bookmarks-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await registerBookmarkRoutes(app, { db });
    await app.ready();
    bookId = Number(db.prepare(`
      INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
      VALUES ('书签书', null, 'txt', 3, 'done', 3, ?)
    `).run(nowIso()).lastInsertRowid);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('增删查书签', async () => {
    const created = JSON.parse((await app.inject({
      method: 'POST',
      url: `/api/books/${bookId}/bookmarks`,
      payload: { chapter_idx: 1, scroll_pct: 0.42, note: '关键伏笔' }
    })).body);
    expect(created).toMatchObject({ chapter_idx: 1, scroll_pct: 0.42, note: '关键伏笔' });

    const list = JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/bookmarks` })).body);
    expect(list.length).toBe(1);

    await app.inject({ method: 'DELETE', url: `/api/books/${bookId}/bookmarks/${created.id}` });
    expect(JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/bookmarks` })).body)).toEqual([]);
  });

  it('chapter_idx 非法返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/books/${bookId}/bookmarks`,
      payload: { chapter_idx: 'x' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('删除书时级联清理书签', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/books/${bookId}/bookmarks`,
      payload: { chapter_idx: 0, scroll_pct: 0 }
    });
    deleteBookData(db, bookId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE book_id = ?').get(bookId).count).toBe(0);
  });
});
