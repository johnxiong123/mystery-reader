import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { bindProgressDb, createExtractor, isUnsupportedResponseFormatError } from './extractor.js';

describe('extractor', () => {
  let tempDir;
  let db;
  let warnSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-test-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    bindProgressDb(db);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('兼容不支持 response_format 的 OpenAI 兼容接口', async () => {
    const bookId = seedBook(db);
    const calls = [];
    const aiClient = mockAiClient(async (request) => {
      calls.push(request);
      if (calls.length === 1) {
        const error = new Error('Unsupported parameter: response_format');
        error.status = 400;
        error.param = 'response_format';
        throw error;
      }
      return extractionResponse({
        characters: [{ name: '林砚', aliases: [], identity: '记者' }],
        relationships: [],
        events: [{ description: '林砚收到匿名信', involved: ['林砚'] }]
      });
    });

    const extractor = createExtractor({
      db,
      aiClient,
      config: { ai: { model: 'deepseek-chat' } }
    });

    await expect(extractor.extractChapter(bookId, 0, { countProgress: true })).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].response_format).toEqual({ type: 'json_object' });
    expect(calls[1].response_format).toBeUndefined();
    expect(db.prepare('SELECT extract_status FROM chapters WHERE book_id = ?').get(bookId).extract_status).toBe('done');
    expect(db.prepare('SELECT COUNT(*) AS count FROM characters WHERE book_id = ?').get(bookId).count).toBe(1);
  });

  it('章节抽取失败时书籍状态保持 error，不伪装成 done', async () => {
    const bookId = seedBook(db);
    const aiClient = mockAiClient(async () => extractionResponse({ characters: [], relationships: [] }));
    const extractor = createExtractor({
      db,
      aiClient,
      config: { ai: { model: 'deepseek-chat' } }
    });

    await extractor.extractBook(bookId);

    const book = db.prepare('SELECT import_status, analyzed_chapters FROM books WHERE id = ?').get(bookId);
    const chapter = db.prepare('SELECT extract_status FROM chapters WHERE book_id = ?').get(bookId);
    expect(book.import_status).toBe('error');
    expect(book.analyzed_chapters).toBe(1);
    expect(chapter.extract_status).toBe('error');
  });

  it('识别 response_format 不兼容错误', () => {
    const error = new Error('Invalid parameter: response_format is not supported with this model');
    error.status = 400;
    expect(isUnsupportedResponseFormatError(error)).toBe(true);
  });
});

function seedBook(db) {
  const result = db.prepare(`
    INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
    VALUES (?, ?, ?, 1, 'parsing', 0, ?)
  `).run('测试书', null, 'txt', nowIso());
  const bookId = Number(result.lastInsertRowid);
  db.prepare(`
    INSERT INTO chapters (book_id, idx, title, content, extract_status)
    VALUES (?, 0, '第一章', '林砚推开旧书房的门。', 'pending')
  `).run(bookId);
  db.prepare(`
    INSERT INTO reading_progress (book_id, current_chapter, updated_at)
    VALUES (?, 0, ?)
  `).run(bookId, nowIso());
  return bookId;
}

function mockAiClient(create) {
  return {
    chat: {
      completions: {
        create
      }
    }
  };
}

function extractionResponse(payload) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload)
        }
      }
    ]
  };
}
