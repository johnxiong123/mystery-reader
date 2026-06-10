import { badRequest, notFound } from '../errors.js';
import { nowIso } from '../db.js';

export async function registerBookmarkRoutes(app, { db }) {
  app.get('/api/books/:id/bookmarks', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    ensureBook(db, bookId);
    return db.prepare(`
      SELECT id, chapter_idx, scroll_pct, note, created_at
      FROM bookmarks WHERE book_id = ? ORDER BY chapter_idx ASC, created_at ASC
    `).all(bookId);
  });

  app.post('/api/books/:id/bookmarks', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const book = ensureBook(db, bookId);
    const chapterIdx = Number(request.body?.chapter_idx);
    if (!Number.isInteger(chapterIdx) || chapterIdx < 0 || chapterIdx >= book.total_chapters) {
      throw badRequest('chapter_idx 必须是有效章节序号。');
    }
    const scrollPct = Math.max(0, Math.min(1, Number(request.body?.scroll_pct) || 0));
    const note = typeof request.body?.note === 'string' ? request.body.note.slice(0, 200) : null;
    const result = db.prepare(`
      INSERT INTO bookmarks (book_id, chapter_idx, scroll_pct, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(bookId, chapterIdx, scrollPct, note, nowIso());
    return db.prepare('SELECT id, chapter_idx, scroll_pct, note, created_at FROM bookmarks WHERE id = ?')
      .get(Number(result.lastInsertRowid));
  });

  app.delete('/api/books/:id/bookmarks/:bookmarkId', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const bookmarkId = numberParam(request.params.bookmarkId, 'bookmarkId');
    ensureBook(db, bookId);
    const result = db.prepare('DELETE FROM bookmarks WHERE id = ? AND book_id = ?').run(bookmarkId, bookId);
    if (!result.changes) throw notFound('书签不存在。');
    return { ok: true };
  });
}

function ensureBook(db, id) {
  const book = db.prepare('SELECT id, total_chapters FROM books WHERE id = ?').get(id);
  if (!book) throw notFound('书籍不存在。');
  return book;
}

function numberParam(value, name) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw badRequest(`${name} 必须是非负整数。`);
  return num;
}
