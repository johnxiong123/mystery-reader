import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { badRequest, notFound } from '../errors.js';
import { nowIso } from '../db.js';
import { parseTxt } from '../ingest/parseTxt.js';
import { parseEpub } from '../ingest/parseEpub.js';
import { subscribeImportProgress } from '../importProgress.js';

const TERMINAL_IMPORT_STATUSES = new Set(['done', 'error', 'pending_config']);

export async function registerBookRoutes(app, { db, config, extractor, settingsStore }) {
  app.post('/api/books/import', async (request) => {
    const file = await request.file();
    if (!file) throw badRequest('请上传 epub 或 txt 文件。');

    const ext = path.extname(file.filename || '').toLowerCase();
    if (!['.txt', '.epub'].includes(ext)) throw badRequest('仅支持 txt 或 epub 文件。');

    let parsed;
    if (ext === '.txt') {
      const buffer = await file.toBuffer();
      parsed = parseTxt(buffer, file.filename);
    } else {
      const safeName = `${Date.now()}-${path.basename(file.filename).replace(/[^\w.-]/g, '_')}`;
      const uploadPath = path.join(config.uploadDir, safeName);
      await pipeline(file.file, fs.createWriteStream(uploadPath));
      parsed = await parseEpub(uploadPath);
    }

    if (!parsed.chapters.length) throw badRequest('未解析到有效章节。');

    const aiSettings = settingsStore?.getAiSettings?.() || config.ai || {};
    const canExtract = Boolean(aiSettings.configured || aiSettings.apiKey);
    const importStatus = canExtract ? 'parsing' : 'pending_config';

    const tx = db.transaction(() => {
      const bookResult = db.prepare(`
        INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run(parsed.title, parsed.author, ext.slice(1), parsed.chapters.length, importStatus, nowIso());
      const bookId = Number(bookResult.lastInsertRowid);

      const insertChapter = db.prepare(`
        INSERT INTO chapters (book_id, idx, title, content, extract_status, word_count)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `);
      parsed.chapters.forEach((chapter, idx) => {
        insertChapter.run(bookId, idx, chapter.title || `第 ${idx + 1} 章`, chapter.content, chapter.content.length);
      });
      db.prepare(`
        INSERT INTO reading_progress (book_id, current_chapter, updated_at)
        VALUES (?, 0, ?)
      `).run(bookId, nowIso());

      return bookId;
    });

    const bookId = tx();
    if (canExtract) {
      extractor.extractBook(bookId).catch((error) => {
        request.log.error({ err: error, bookId }, 'import extraction failed');
        db.prepare('UPDATE books SET import_status = ? WHERE id = ?').run('error', bookId);
      });
    }

    return { bookId, status: importStatus };
  });

  app.get('/api/books', async () => db.prepare(`
    SELECT id, title, author, total_chapters, import_status, analyzed_chapters
    FROM books
    ORDER BY created_at DESC, id DESC
  `).all());

  app.get('/api/books/:id', async (request) => {
    const id = numberParam(request.params.id, 'id');
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!book) throw notFound('书籍不存在。');
    const progress = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = ?').get(id);
    return {
      ...book,
      current_chapter: progress?.current_chapter ?? 0,
      furthest_chapter: progress?.furthest_chapter ?? 0
    };
  });

  app.delete('/api/books/:id', async (request) => {
    const id = numberParam(request.params.id, 'id');
    const deleted = deleteBookData(db, id);
    if (!deleted) throw notFound('书籍不存在。');
    return { ok: true };
  });

  app.get('/api/books/:id/import-progress', async (request, reply) => {
    const id = numberParam(request.params.id, 'id');
    const book = db.prepare(`
      SELECT
        books.analyzed_chapters,
        books.total_chapters,
        books.import_status,
        (
          SELECT COUNT(*)
          FROM chapters
          WHERE chapters.book_id = books.id AND chapters.extract_status = 'error'
        ) AS failed_chapters
      FROM books
      WHERE books.id = ?
    `).get(id);
    if (!book) throw notFound('书籍不存在。');

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });

    const send = (payload) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (TERMINAL_IMPORT_STATUSES.has(payload.status)) reply.raw.end();
    };

    const unsubscribe = subscribeImportProgress(id, send);
    request.raw.on('close', unsubscribe);
    send({
      analyzed: book.analyzed_chapters,
      total: book.total_chapters,
      status: book.import_status,
      failed: book.failed_chapters || 0
    });
  });

  app.get('/api/books/:id/chapters/:idx', async (request) => {
    const id = numberParam(request.params.id, 'id');
    const idx = numberParam(request.params.idx, 'idx');
    const chapter = db.prepare(`
      SELECT idx, title, content FROM chapters WHERE book_id = ? AND idx = ?
    `).get(id, idx);
    if (!chapter) throw notFound('章节不存在。');
    return chapter;
  });

  app.get('/api/books/:id/progress', async (request) => {
    const id = numberParam(request.params.id, 'id');
    ensureBook(db, id);
    const row = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = ?').get(id);
    const current = row?.current_chapter ?? 0;
    const furthest = row?.furthest_chapter ?? 0;
    return { current_chapter: current, furthest_chapter: furthest, percent: computePercent(db, id, furthest) };
  });

  app.put('/api/books/:id/progress', async (request) => {
    const id = numberParam(request.params.id, 'id');
    const book = ensureBook(db, id);
    const requested = Number(request.body?.current_chapter);
    if (!Number.isInteger(requested)) throw badRequest('current_chapter 必须是整数。');
    const current = Math.max(0, Math.min(requested, book.total_chapters - 1));
    db.prepare(`
      INSERT INTO reading_progress (book_id, current_chapter, furthest_chapter, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        current_chapter = excluded.current_chapter,
        furthest_chapter = MAX(reading_progress.furthest_chapter, excluded.furthest_chapter),
        updated_at = excluded.updated_at
    `).run(id, current, current, nowIso());
    const row = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = ?').get(id);
    return { ...row, percent: computePercent(db, id, row.furthest_chapter) };
  });

  app.post('/api/books/:id/chapters/:idx/reextract', async (request) => {
    const id = numberParam(request.params.id, 'id');
    const idx = numberParam(request.params.idx, 'idx');
    ensureBook(db, id);
    const chapter = db.prepare('SELECT id FROM chapters WHERE book_id = ? AND idx = ?').get(id, idx);
    if (!chapter) throw notFound('章节不存在。');
    db.prepare('UPDATE chapters SET extract_status = ? WHERE id = ?').run('pending', chapter.id);
    const ok = await extractor.extractChapter(id, idx, { countProgress: false });
    const remaining = db.prepare(
      'SELECT COUNT(*) AS count FROM chapters WHERE book_id = ? AND extract_status = ?'
    ).get(id, 'error').count;
    if (ok && remaining === 0) {
      db.prepare('UPDATE books SET import_status = ? WHERE id = ?').run('done', id);
    } else if (!ok) {
      db.prepare('UPDATE books SET import_status = ? WHERE id = ?').run('error', id);
    }
    return { ok };
  });

  app.post('/api/books/:id/reextract', async (request) => {
    const id = numberParam(request.params.id, 'id');
    ensureBook(db, id);
    db.prepare('UPDATE chapters SET extract_status = ? WHERE book_id = ?').run('pending', id);
    db.prepare('UPDATE books SET import_status = ?, analyzed_chapters = 0 WHERE id = ?').run('extracting', id);
    extractor.extractBook(id).catch((error) => {
      request.log.error({ err: error, bookId: id }, 'reextract failed');
      db.prepare('UPDATE books SET import_status = ? WHERE id = ?').run('error', id);
    });
    return { ok: true };
  });
}

function ensureBook(db, id) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!book) throw notFound('书籍不存在。');
  return book;
}

export function deleteBookData(db, id) {
  const book = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
  if (!book) return false;

  const tx = db.transaction(() => {
    for (const table of ['reading_progress', 'events', 'relationships', 'characters', 'chapters']) {
      db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(id);
    }
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
  });
  tx();
  return true;
}

function computePercent(db, bookId, furthest) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN idx <= ? THEN word_count END), 0) AS read_words,
      COALESCE(SUM(word_count), 0) AS total_words
    FROM chapters WHERE book_id = ?
  `).get(furthest, bookId);
  if (!row.total_words) return 0;
  return Math.round((row.read_words / row.total_words) * 100);
}

function numberParam(value, name) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw badRequest(`${name} 必须是非负整数。`);
  return num;
}
