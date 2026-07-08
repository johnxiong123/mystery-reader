import { buildExtractionMessages, validateExtractionJson } from '../../../../server/src/ai/prompt.js';
import { loadArtifact, saveArtifact } from '../paths.js';

const MAX_CHARS = 12000;

export function createDossierStore(snapshot = null) {
  const characters = (snapshot?.characters || []).map((c) => ({ ...c, aliases: [...(c.aliases || [])] }));
  const relationships = [...(snapshot?.relationships || [])];
  const events = [...(snapshot?.events || [])];
  let nextId = Math.max(0, ...characters.map((c) => c.id), ...relationships.map((r) => r.id), ...events.map((e) => e.id)) + 1;

  const normalize = (value) => String(value || '').trim().toLocaleLowerCase();

  function findCharacter(name) {
    const n = normalize(name);
    return characters.find((c) => normalize(c.name) === n || c.aliases.some((a) => normalize(a) === n));
  }

  function ensureCharacter(name, patch = {}) {
    let existing = findCharacter(name);
    if (!existing) {
      existing = {
        id: nextId++,
        name: String(name).trim(),
        aliases: [...(patch.aliases || [])],
        identity: patch.identity || null,
        first_seen_chapter: patch.firstSeenChapter ?? 0
      };
      characters.push(existing);
      return existing;
    }
    for (const alias of patch.aliases || []) {
      if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
    }
    if (!existing.identity && patch.identity) existing.identity = patch.identity;
    return existing;
  }

  function merge(chapterIdx, extraction) {
    for (const char of extraction.characters) {
      ensureCharacter(char.name, { aliases: char.aliases, identity: char.identity, firstSeenChapter: chapterIdx });
    }
    for (const rel of extraction.relationships) {
      const from = ensureCharacter(rel.from, { firstSeenChapter: chapterIdx });
      const to = ensureCharacter(rel.to, { firstSeenChapter: chapterIdx });
      const exists = relationships.some((r) => r.type === rel.type &&
        ((r.from_char_id === from.id && r.to_char_id === to.id) || (r.from_char_id === to.id && r.to_char_id === from.id)));
      if (!exists) {
        relationships.push({ id: nextId++, from_char_id: from.id, to_char_id: to.id, type: rel.type, reveal_chapter: chapterIdx, description: rel.description });
      }
    }
    for (const event of extraction.events) {
      const involved = [...new Set(event.involved.map((name) => ensureCharacter(name, { firstSeenChapter: chapterIdx }).id))];
      events.push({ id: nextId++, description: event.description, occur_chapter: event.occur_chapter, reveal_chapter: chapterIdx, involved });
    }
  }

  return {
    merge,
    knownCharacters: () => characters.map((c) => ({ name: c.name, aliases: JSON.stringify(c.aliases) })),
    toJson: () => ({ characters, relationships, events })
  };
}

function splitContent(content) {
  if (content.length <= MAX_CHARS) return [content];
  const paragraphs = content.split(/\n{2,}/);
  const blocks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHARS) {
      if (current) { blocks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += MAX_CHARS) blocks.push(paragraph.slice(i, i + MAX_CHARS));
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHARS && current) { blocks.push(current); current = paragraph; }
    else current = next;
  }
  if (current) blocks.push(current);
  return blocks;
}

export async function runExtract({ slug, ai }) {
  const chapters = loadArtifact(slug, 'chapters.zh');
  if (!chapters) throw new Error('请先执行 translate 步骤。');

  const snapshot = loadArtifact(slug, 'dossier');
  const store = createDossierStore(snapshot);
  const startFrom = snapshot ? snapshot.extracted_upto + 1 : 0;

  for (const chapter of chapters) {
    if (chapter.idx < startFrom) continue;
    for (const block of splitContent(chapter.content)) {
      const raw = await ai.chatJson(buildExtractionMessages({
        chapterIdx: chapter.idx,
        content: block,
        knownCharacters: store.knownCharacters()
      }));
      store.merge(chapter.idx, validateExtractionJson(raw, chapter.idx));
    }
    saveArtifact(slug, 'dossier', { ...store.toJson(), extracted_upto: chapter.idx });
    console.log(`[extract] ${slug} 第 ${chapter.idx + 1}/${chapters.length} 章完成`);
  }
  return loadArtifact(slug, 'dossier');
}
