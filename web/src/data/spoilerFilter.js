const SNIPPET_RADIUS = 40;
const PER_CHAPTER_LIMIT = 5;
const TOTAL_LIMIT = 100;

export function clampUpto(upto, totalChapters) {
  const parsed = Number(upto);
  if (!Number.isInteger(parsed)) return 0;
  return Math.max(0, Math.min(parsed, totalChapters - 1));
}

export function filterGraph(dossier, upto) {
  const nodes = dossier.characters
    .filter((c) => c.first_seen_chapter <= upto)
    .map((c) => ({ id: c.id, name: c.name, aliases: c.aliases || [], identity: c.identity, first_seen_chapter: c.first_seen_chapter }));
  const visible = new Set(nodes.map((n) => n.id));
  const edges = dossier.relationships
    .filter((r) => r.reveal_chapter <= upto && visible.has(r.from_char_id) && visible.has(r.to_char_id))
    .map((r) => ({ id: r.id, source: r.from_char_id, target: r.to_char_id, type: r.type, reveal_chapter: r.reveal_chapter, description: r.description }));
  return { nodes, edges };
}

export function filterCharacter(dossier, charId, upto) {
  const character = dossier.characters.find((c) => c.id === Number(charId) && c.first_seen_chapter <= upto);
  if (!character) return null;
  const visible = dossier.characters.filter((c) => c.first_seen_chapter <= upto);
  const nameById = new Map(visible.map((c) => [c.id, c.name]));

  const relationships = dossier.relationships
    .filter((r) => r.reveal_chapter <= upto && (r.from_char_id === character.id || r.to_char_id === character.id))
    .filter((r) => nameById.has(r.from_char_id) && nameById.has(r.to_char_id))
    .map((r) => ({
      id: r.id,
      from_char_id: r.from_char_id, from: nameById.get(r.from_char_id),
      to_char_id: r.to_char_id, to: nameById.get(r.to_char_id),
      type: r.type, reveal_chapter: r.reveal_chapter, description: r.description
    }));

  const events = dossier.events
    .filter((e) => e.reveal_chapter <= upto && e.involved.includes(character.id))
    .map((e) => ({
      id: e.id, description: e.description, occur_chapter: e.occur_chapter, reveal_chapter: e.reveal_chapter,
      involved: e.involved.filter((id) => nameById.has(id)).map((id) => nameById.get(id))
    }));

  return {
    id: character.id, name: character.name, aliases: character.aliases || [],
    identity: character.identity, first_seen_chapter: character.first_seen_chapter,
    relationships, events
  };
}

export function filterTimeline(dossier, upto) {
  const nameById = new Map(dossier.characters.filter((c) => c.first_seen_chapter <= upto).map((c) => [c.id, c.name]));
  return dossier.events
    .filter((e) => e.reveal_chapter <= upto)
    .sort((a, b) => a.occur_chapter - b.occur_chapter || a.reveal_chapter - b.reveal_chapter || a.id - b.id)
    .map((e) => ({
      id: e.id, description: e.description, occur_chapter: e.occur_chapter, reveal_chapter: e.reveal_chapter,
      involved: e.involved.filter((id) => nameById.has(id)).map((id) => nameById.get(id))
    }));
}

export function maskChapterTitles(chapters, upto) {
  return chapters.map((c) => ({ idx: c.idx, title: c.idx <= upto ? c.title : null }));
}

export function searchChapters(chapters, rawQ, upto) {
  const q = String(rawQ ?? "").trim();
  if (q.length < 2) throw new Error("搜索词至少 2 个字符。");
  if (q.length > 50) throw new Error("搜索词最长 50 个字符。");

  const results = [];
  let truncated = false;
  for (const chapter of chapters) {
    if (chapter.idx > upto) continue;
    let from = 0;
    let hits = 0;
    while (results.length < TOTAL_LIMIT) {
      const at = chapter.content.indexOf(q, from);
      if (at === -1) break;
      if (hits >= PER_CHAPTER_LIMIT) { truncated = true; break; }
      const start = Math.max(0, at - SNIPPET_RADIUS);
      const end = Math.min(chapter.content.length, at + q.length + SNIPPET_RADIUS);
      results.push({
        chapterIdx: chapter.idx,
        title: chapter.title,
        snippet: `${start > 0 ? "…" : ""}${chapter.content.slice(start, end)}${end < chapter.content.length ? "…" : ""}`,
        matchOffset: at
      });
      hits += 1;
      from = at + q.length;
    }
    if (results.length >= TOTAL_LIMIT) { truncated = true; break; }
  }
  return { results, truncated, upto };
}

export function computePercent(chapters, furthest) {
  let read = 0;
  let total = 0;
  for (const c of chapters) {
    total += c.word_count || 0;
    if (c.idx <= furthest) read += c.word_count || 0;
  }
  if (!total) return 0;
  return Math.round((read / total) * 100);
}
