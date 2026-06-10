import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { installErrorHandler } from '../errors.js';
import { registerSearchRoutes } from './search.js';

describe('book search', () => {
  let tempDir;
  let db;
  let app;
  let bookId;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-search-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await registerSearchRoutes(app, { db });
    await app.ready();

    bookId = Number(db.prepare(`
      INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
      VALUES ('搜索书', null, 'txt', 3, 'done', 3, ?)
    `).run(nowIso()).lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO chapters (book_id, idx, title, content, extract_status, word_count)
      VALUES (?, ?, ?, ?, 'done', LENGTH(?))
    `);
    insert.run(bookId, 0, '一', '林砚在雨夜推开了旧书店的门，匿名信就放在柜台上。', '林砚在雨夜推开了旧书店的门，匿名信就放在柜台上。');
    insert.run(bookId, 1, '二', '名单上的第三个名字让林砚停住了呼吸。', '名单上的第三个名字让林砚停住了呼吸。');
    insert.run(bookId, 2, '三', '凶手终于现身，匿名信的笔迹与他完全吻合。', '凶手终于现身，匿名信的笔迹与他完全吻合。');
    db.prepare(`INSERT INTO reading_progress (book_id, current_chapter, furthest_chapter, updated_at)
      VALUES (?, 1, 1, ?)`).run(bookId, nowIso());
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('只命中 upto 范围内的章节，绝不泄露后文', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=匿名信&upto=1` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(1);
    expect(body.results[0].chapterIdx).toBe(0);
    expect(body.results.some((r) => r.chapterIdx === 2)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('凶手');
  });

  it('snippet 含关键词且带 matchOffset', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=林砚&upto=1` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(2);
    for (const r of body.results) {
      expect(r.snippet).toContain('林砚');
      expect(typeof r.matchOffset).toBe('number');
    }
  });

  it('q 少于 2 字符返回 400', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=林&upto=1` });
    expect(res.statusCode).toBe(400);
  });

  it('不带 upto 时按 furthest 过滤', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=匿名信` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(1); // furthest=1，第 2 章不可见
  });

  it('单章命中超过 5 处只返回 5 条且 truncated=true', async () => {
    const longContent = Array.from({ length: 8 }, (_, i) => `第${i}处线索出现了。`).join('填充文字。');
    db.prepare('UPDATE chapters SET content = ?, word_count = LENGTH(?) WHERE book_id = ? AND idx = 0')
      .run(longContent, longContent, bookId);
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=线索&upto=0` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(5);
    expect(body.truncated).toBe(true);
  });
});
