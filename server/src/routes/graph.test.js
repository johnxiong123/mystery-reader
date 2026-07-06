import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { installErrorHandler } from '../errors.js';
import { registerGraphRoutes } from './graph.js';

describe('graph nodes', () => {
  let tempDir;
  let db;
  let app;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-graph-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await registerGraphRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('nodes 返回 aliases 数组，且按 upto 防剧透', async () => {
    const bookId = Number(db.prepare(`
      INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
      VALUES ('图书', null, 'txt', 3, 'done', 3, ?)
    `).run(nowIso()).lastInsertRowid);
    db.prepare(`INSERT INTO characters (book_id, name, aliases, identity, first_seen_chapter)
      VALUES (?, '李明远', '["老李"]', '教师', 0)`).run(bookId);
    db.prepare(`INSERT INTO characters (book_id, name, aliases, identity, first_seen_chapter)
      VALUES (?, '神秘人', '["影子"]', null, 2)`).run(bookId);
    db.prepare(`INSERT INTO reading_progress (book_id, current_chapter, furthest_chapter, updated_at)
      VALUES (?, 0, 0, ?)`).run(bookId, nowIso());

    const body = JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/graph?upto=0` })).body);
    expect(body.nodes.length).toBe(1);
    expect(body.nodes[0].aliases).toEqual(['老李']);
  });
});
