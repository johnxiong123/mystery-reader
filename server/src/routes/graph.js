import { badRequest, notFound } from '../errors.js';

export async function registerGraphRoutes(app, { db }) {
  app.get('/api/books/:id/graph', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const upto = resolveUpto(db, bookId, request.query.upto);

    const nodes = db.prepare(`
      SELECT id, name, identity, first_seen_chapter
      FROM characters
      WHERE book_id = ? AND first_seen_chapter <= ?
      ORDER BY first_seen_chapter ASC, id ASC
    `).all(bookId, upto);

    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = db.prepare(`
      SELECT id, from_char_id AS source, to_char_id AS target, type, reveal_chapter, description
      FROM relationships
      WHERE book_id = ? AND reveal_chapter <= ?
      ORDER BY reveal_chapter ASC, id ASC
    `).all(bookId, upto)
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));

    return { nodes, edges };
  });

  app.get('/api/books/:id/character/:charId', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const charId = numberParam(request.params.charId, 'charId');
    const upto = resolveUpto(db, bookId, request.query.upto);

    const character = db.prepare(`
      SELECT id, name, aliases, identity, first_seen_chapter
      FROM characters
      WHERE book_id = ? AND id = ? AND first_seen_chapter <= ?
    `).get(bookId, charId, upto);
    if (!character) throw notFound('人物不存在或尚未揭露。');

    const visibleCharacters = db.prepare(`
      SELECT id, name FROM characters WHERE book_id = ? AND first_seen_chapter <= ?
    `).all(bookId, upto);
    const nameById = new Map(visibleCharacters.map((item) => [item.id, item.name]));
    const visibleIds = new Set(nameById.keys());

    const relationships = db.prepare(`
      SELECT id, from_char_id, to_char_id, type, reveal_chapter, description
      FROM relationships
      WHERE book_id = ? AND reveal_chapter <= ?
        AND (from_char_id = ? OR to_char_id = ?)
      ORDER BY reveal_chapter ASC, id ASC
    `).all(bookId, upto, charId, charId)
      .filter((rel) => visibleIds.has(rel.from_char_id) && visibleIds.has(rel.to_char_id))
      .map((rel) => ({
        id: rel.id,
        from_char_id: rel.from_char_id,
        from: nameById.get(rel.from_char_id),
        to_char_id: rel.to_char_id,
        to: nameById.get(rel.to_char_id),
        type: rel.type,
        reveal_chapter: rel.reveal_chapter,
        description: rel.description
      }));

    const events = db.prepare(`
      SELECT id, description, occur_chapter, reveal_chapter, involved_char_ids
      FROM events
      WHERE book_id = ? AND reveal_chapter <= ?
      ORDER BY occur_chapter ASC, reveal_chapter ASC, id ASC
    `).all(bookId, upto)
      .filter((event) => parseIdArray(event.involved_char_ids).includes(charId))
      .map((event) => ({
        id: event.id,
        description: event.description,
        occur_chapter: event.occur_chapter,
        reveal_chapter: event.reveal_chapter,
        involved: parseIdArray(event.involved_char_ids)
          .filter((id) => visibleIds.has(id))
          .map((id) => nameById.get(id))
      }));

    return {
      id: character.id,
      name: character.name,
      aliases: parseStringArray(character.aliases),
      identity: character.identity,
      first_seen_chapter: character.first_seen_chapter,
      relationships,
      events
    };
  });

  app.get('/api/books/:id/timeline', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const upto = resolveUpto(db, bookId, request.query.upto);
    const visibleCharacters = db.prepare(`
      SELECT id, name FROM characters WHERE book_id = ? AND first_seen_chapter <= ?
    `).all(bookId, upto);
    const nameById = new Map(visibleCharacters.map((item) => [item.id, item.name]));

    return db.prepare(`
      SELECT id, description, occur_chapter, reveal_chapter, involved_char_ids
      FROM events
      WHERE book_id = ? AND reveal_chapter <= ?
      ORDER BY occur_chapter ASC, reveal_chapter ASC, id ASC
    `).all(bookId, upto).map((event) => ({
      id: event.id,
      description: event.description,
      occur_chapter: event.occur_chapter,
      reveal_chapter: event.reveal_chapter,
      involved: parseIdArray(event.involved_char_ids)
        .filter((id) => nameById.has(id))
        .map((id) => nameById.get(id))
    }));
  });
}

function resolveUpto(db, bookId, rawUpto) {
  const book = db.prepare('SELECT id, total_chapters FROM books WHERE id = ?').get(bookId);
  if (!book) throw notFound('书籍不存在。');

  if (rawUpto != null) {
    const parsed = Number(rawUpto);
    if (!Number.isInteger(parsed) || parsed < 0) throw badRequest('upto 必须是非负整数。');
    return Math.min(parsed, book.total_chapters - 1);
  }

  const progress = db.prepare('SELECT current_chapter FROM reading_progress WHERE book_id = ?').get(bookId);
  return progress?.current_chapter ?? 0;
}

function numberParam(value, name) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw badRequest(`${name} 必须是非负整数。`);
  return num;
}

function parseIdArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function parseStringArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
