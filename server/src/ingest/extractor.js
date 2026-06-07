import { buildExtractionMessages, validateExtractionJson } from '../ai/prompt.js';
import { createAiClient } from '../ai/client.js';
import { publishImportProgress } from '../importProgress.js';

const MAX_CHARS = 12000;

export function createExtractor({ db, aiClient, config, getAiSettings }) {
  let jsonResponseFormatAvailable = true;

  async function extractBook(bookId) {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (!book) return;

    db.prepare('UPDATE books SET import_status = ? WHERE id = ?').run('extracting', bookId);
    publish(bookId);

    const chapters = db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY idx ASC').all(bookId);
    const failedChapters = [];
    for (const chapter of chapters) {
      const ok = await extractChapter(bookId, chapter.idx, { countProgress: true });
      if (!ok) failedChapters.push(chapter.idx);
    }

    db.prepare('UPDATE books SET import_status = ? WHERE id = ?').run(
      failedChapters.length ? 'error' : 'done',
      bookId
    );
    if (failedChapters.length) {
      console.warn(`[extractor] book ${bookId} finished with failed chapters: ${failedChapters.join(', ')}`);
    }
    publish(bookId);
  }

  async function extractChapter(bookId, chapterIdx, options = {}) {
    const chapter = db.prepare('SELECT * FROM chapters WHERE book_id = ? AND idx = ?').get(bookId, chapterIdx);
    if (!chapter) throw new Error('章节不存在。');

    let ok = false;
    try {
      const knownCharacters = () => db.prepare(
        'SELECT id, name, aliases, identity, first_seen_chapter FROM characters WHERE book_id = ? ORDER BY id ASC'
      ).all(bookId);

      const blocks = splitContent(chapter.content);
      const merged = { characters: [], relationships: [], events: [] };

      for (const block of blocks) {
        const result = await callWithRetry({
          chapterIdx,
          content: block,
          knownCharacters: knownCharacters()
        });
        merged.characters.push(...result.characters);
        merged.relationships.push(...result.relationships);
        merged.events.push(...result.events);
      }

      mergeExtraction(db, bookId, chapterIdx, merged);
      db.prepare('UPDATE chapters SET extract_status = ? WHERE id = ?').run('done', chapter.id);
      ok = true;
    } catch (error) {
      const summary = summarizeError(error);
      console.warn(`[extractor] chapter extraction failed book=${bookId} chapter=${chapterIdx}: ${summary}`);
      db.prepare('UPDATE chapters SET extract_status = ? WHERE id = ?').run('error', chapter.id);
    } finally {
      if (options.countProgress) {
        db.prepare('UPDATE books SET analyzed_chapters = MIN(analyzed_chapters + 1, total_chapters) WHERE id = ?')
          .run(bookId);
      }
      publish(bookId);
    }
    return ok;
  }

  async function callWithRetry({ chapterIdx, content, knownCharacters }) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await callCompletion({ chapterIdx, content, knownCharacters, jsonMode: jsonResponseFormatAvailable });
      } catch (error) {
        lastError = error;
        if (jsonResponseFormatAvailable && isUnsupportedResponseFormatError(error)) {
          jsonResponseFormatAvailable = false;
          console.warn('[extractor] AI response_format=json_object is unsupported; retrying with prompt-only JSON output.');
          try {
            return await callCompletion({ chapterIdx, content, knownCharacters, jsonMode: false });
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }
      }
    }
    throw lastError || new Error('AI 抽取失败。');
  }

  async function callCompletion({ chapterIdx, content, knownCharacters, jsonMode }) {
    const ai = getAiRuntime();
    const request = {
      model: ai.settings.model,
      messages: buildExtractionMessages({ chapterIdx, content, knownCharacters })
    };
    if (jsonMode) {
      request.response_format = { type: 'json_object' };
    }
    const completion = await ai.client.chat.completions.create(request);
    const text = completion.choices?.[0]?.message?.content || '';
    return validateExtractionJson(text, chapterIdx);
  }

  return { extractBook, extractChapter };

  function getAiRuntime() {
    if (getAiSettings) {
      const settings = getAiSettings();
      if (!settings?.configured || !settings.apiKey) throw new Error('缺少 API Key，无法进行 AI 抽取。');
      return {
        settings,
        client: createAiClient({ ai: settings })
      };
    }
    if (!config?.ai?.apiKey && !aiClient) throw new Error('缺少 API Key，无法进行 AI 抽取。');
    return {
      settings: config.ai,
      client: aiClient || createAiClient(config)
    };
  }
}

export function mergeExtraction(db, bookId, chapterIdx, extraction) {
  const tx = db.transaction(() => {
    for (const char of extraction.characters) {
      ensureCharacter(db, bookId, char.name, {
        aliases: char.aliases,
        identity: char.identity,
        firstSeenChapter: chapterIdx
      });
    }

    for (const rel of extraction.relationships) {
      const from = ensureCharacter(db, bookId, rel.from, { firstSeenChapter: chapterIdx });
      const to = ensureCharacter(db, bookId, rel.to, { firstSeenChapter: chapterIdx });
      const exists = db.prepare(`
        SELECT id FROM relationships
        WHERE book_id = ? AND type = ?
          AND ((from_char_id = ? AND to_char_id = ?) OR (from_char_id = ? AND to_char_id = ?))
        LIMIT 1
      `).get(bookId, rel.type, from.id, to.id, to.id, from.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO relationships (book_id, from_char_id, to_char_id, type, reveal_chapter, description)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(bookId, from.id, to.id, rel.type, chapterIdx, rel.description);
      }
    }

    for (const event of extraction.events) {
      const involvedIds = event.involved.map((name) => (
        ensureCharacter(db, bookId, name, { firstSeenChapter: chapterIdx }).id
      ));
      db.prepare(`
        INSERT INTO events (book_id, description, occur_chapter, reveal_chapter, involved_char_ids)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        bookId,
        event.description,
        event.occur_chapter,
        chapterIdx,
        JSON.stringify([...new Set(involvedIds)])
      );
    }
  });

  tx();
}

function ensureCharacter(db, bookId, name, patch = {}) {
  const normalized = normalize(name);
  const chars = db.prepare('SELECT * FROM characters WHERE book_id = ?').all(bookId);
  let existing = chars.find((char) => {
    const aliases = parseArray(char.aliases);
    return normalize(char.name) === normalized || aliases.some((alias) => normalize(alias) === normalized);
  });

  if (!existing) {
    const aliases = patch.aliases || [];
    const result = db.prepare(`
      INSERT INTO characters (book_id, name, aliases, identity, first_seen_chapter)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      bookId,
      name.trim(),
      JSON.stringify(aliases),
      patch.identity || null,
      patch.firstSeenChapter ?? 0
    );
    return db.prepare('SELECT * FROM characters WHERE id = ?').get(result.lastInsertRowid);
  }

  const aliases = new Set(parseArray(existing.aliases));
  for (const alias of patch.aliases || []) aliases.add(alias);
  const identity = existing.identity || patch.identity || null;
  db.prepare('UPDATE characters SET aliases = ?, identity = ? WHERE id = ?')
    .run(JSON.stringify([...aliases]), identity, existing.id);
  existing = db.prepare('SELECT * FROM characters WHERE id = ?').get(existing.id);
  return existing;
}

function splitContent(content) {
  if (content.length <= MAX_CHARS) return [content];

  const paragraphs = content.split(/\n{2,}/);
  const blocks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHARS) {
      if (current) {
        blocks.push(current);
        current = '';
      }
      for (let i = 0; i < paragraph.length; i += MAX_CHARS) {
        blocks.push(paragraph.slice(i, i + MAX_CHARS));
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHARS && current) {
      blocks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

function publish(bookId) {
  const book = dbForPublish.getBook?.(bookId);
  if (!book) return;
  publishImportProgress(bookId, {
    analyzed: book.analyzed_chapters,
    total: book.total_chapters,
    status: book.import_status,
    failed: book.failed_chapters || 0
  });
}

const dbForPublish = {
  getBook: null
};

export function bindProgressDb(db) {
  dbForPublish.getBook = (bookId) => db.prepare(
    `SELECT
      books.analyzed_chapters,
      books.total_chapters,
      books.import_status,
      (
        SELECT COUNT(*)
        FROM chapters
        WHERE chapters.book_id = books.id AND chapters.extract_status = 'error'
      ) AS failed_chapters
    FROM books
    WHERE books.id = ?`
  ).get(bookId);
}

export function isUnsupportedResponseFormatError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = [
    error?.message,
    error?.code,
    error?.param,
    error?.type
  ].filter(Boolean).join(' ').toLowerCase();

  if (!text.includes('response_format')) return false;
  if (status && ![400, 422].includes(status)) return false;
  return /unsupported|not support|invalid|unknown|unrecognized|not allowed|extra_forbidden|json_object/.test(text);
}

function summarizeError(error) {
  const status = error?.status || error?.statusCode;
  const code = error?.code;
  const message = error?.message || String(error);
  return [
    status ? `status=${status}` : '',
    code ? `code=${code}` : '',
    `message=${String(message).slice(0, 500)}`
  ].filter(Boolean).join(' ');
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function parseArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
