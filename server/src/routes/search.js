import { badRequest, notFound } from '../errors.js';

const SNIPPET_RADIUS = 40;
const PER_CHAPTER_LIMIT = 5;
const TOTAL_LIMIT = 100;

export async function registerSearchRoutes(app, { db }) {
  app.get('/api/books/:id/search', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const book = db.prepare('SELECT id, total_chapters FROM books WHERE id = ?').get(bookId);
    if (!book) throw notFound('书籍不存在。');

    const q = String(request.query.q ?? '').trim();
    if (q.length < 2) throw badRequest('搜索词至少 2 个字符。');
    if (q.length > 50) throw badRequest('搜索词最长 50 个字符。');

    let upto;
    if (request.query.upto != null) {
      const parsed = Number(request.query.upto);
      if (!Number.isInteger(parsed) || parsed < 0) throw badRequest('upto 必须是非负整数。');
      upto = Math.min(parsed, book.total_chapters - 1);
    } else {
      const progress = db.prepare('SELECT furthest_chapter FROM reading_progress WHERE book_id = ?').get(bookId);
      upto = progress?.furthest_chapter ?? 0;
    }

    const chapters = db.prepare(`
      SELECT idx, title, content FROM chapters
      WHERE book_id = ? AND idx <= ? AND instr(content, ?) > 0
      ORDER BY idx ASC
    `).all(bookId, upto, q);

    const results = [];
    let truncated = false;
    for (const chapter of chapters) {
      let from = 0;
      let hits = 0;
      while (results.length < TOTAL_LIMIT) {
        const at = chapter.content.indexOf(q, from);
        if (at === -1) break;
        if (hits >= PER_CHAPTER_LIMIT) {
          truncated = true;
          break;
        }
        const start = Math.max(0, at - SNIPPET_RADIUS);
        const end = Math.min(chapter.content.length, at + q.length + SNIPPET_RADIUS);
        results.push({
          chapterIdx: chapter.idx,
          title: chapter.title,
          snippet: `${start > 0 ? '…' : ''}${chapter.content.slice(start, end)}${end < chapter.content.length ? '…' : ''}`,
          matchOffset: at
        });
        hits += 1;
        from = at + q.length;
      }
      if (results.length >= TOTAL_LIMIT) {
        truncated = true;
        break;
      }
    }

    return { results, truncated, upto };
  });
}

function numberParam(value, name) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw badRequest(`${name} 必须是非负整数。`);
  return num;
}
