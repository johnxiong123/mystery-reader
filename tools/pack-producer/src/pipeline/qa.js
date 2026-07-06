import { loadArtifact } from '../paths.js';

export function runQa({ slug, allow = [] }) {
  const meta = loadArtifact(slug, 'meta');
  const chapters = loadArtifact(slug, 'chapters.zh');
  const glossary = loadArtifact(slug, 'glossary');
  const dossier = loadArtifact(slug, 'dossier');
  if (!meta || !chapters || !glossary || !dossier) throw new Error('缺少中间产物，请先完成前序步骤。');

  const violations = [];
  const allowSet = new Set(allow.map((a) => a.toLowerCase()));
  const fullText = chapters.map((c) => `${c.title}\n${c.content}`).join('\n');

  // 1. foreign-residue
  if (meta.lang === 'ja') {
    for (const chapter of chapters) {
      const hit = (`${chapter.title}${chapter.content}`).match(/[぀-ヿ]+/);
      if (hit) violations.push({ rule: 'foreign-residue', detail: `第 ${chapter.idx + 1} 章残留假名: ${hit[0]}` });
    }
  } else {
    for (const chapter of chapters) {
      for (const token of (`${chapter.title} ${chapter.content}`).match(/[A-Za-z]{3,}/g) || []) {
        if (!allowSet.has(token.toLowerCase())) {
          violations.push({ rule: 'foreign-residue', detail: `第 ${chapter.idx + 1} 章残留: ${token}` });
        }
      }
    }
  }

  // 2. glossary-consistency
  for (const entry of glossary.entries) {
    if (entry.count >= 3 && !fullText.includes(entry.zh)) {
      violations.push({ rule: 'glossary-consistency', detail: `高频术语「${entry.term}→${entry.zh}」未在译文出现` });
    }
  }

  // 3. dossier-bounds
  const total = meta.total_chapters;
  const charIds = new Set(dossier.characters.map((c) => c.id));
  for (const c of dossier.characters) {
    if (c.first_seen_chapter < 0 || c.first_seen_chapter >= total) {
      violations.push({ rule: 'dossier-bounds', detail: `人物「${c.name}」first_seen_chapter=${c.first_seen_chapter} 越界` });
    }
  }
  for (const r of dossier.relationships) {
    if (r.reveal_chapter < 0 || r.reveal_chapter >= total) violations.push({ rule: 'dossier-bounds', detail: `关系 ${r.id} reveal 越界` });
    if (!charIds.has(r.from_char_id) || !charIds.has(r.to_char_id)) violations.push({ rule: 'dossier-bounds', detail: `关系 ${r.id} 引用不存在的人物` });
  }
  for (const e of dossier.events) {
    if (e.reveal_chapter < 0 || e.reveal_chapter >= total || e.occur_chapter < 0 || e.occur_chapter >= total) {
      violations.push({ rule: 'dossier-bounds', detail: `事件 ${e.id} 章号越界` });
    }
    for (const id of e.involved) {
      if (!charIds.has(id)) violations.push({ rule: 'dossier-bounds', detail: `事件 ${e.id} 引用不存在的人物 ${id}` });
    }
  }

  // 4. chapters-integrity
  if (chapters.length !== total) violations.push({ rule: 'chapters-integrity', detail: `章节数 ${chapters.length} ≠ meta ${total}` });
  for (const c of chapters) {
    if (!c.content?.trim()) violations.push({ rule: 'chapters-integrity', detail: `第 ${c.idx + 1} 章正文为空` });
    else if (c.word_count !== c.content.length) violations.push({ rule: 'chapters-integrity', detail: `第 ${c.idx + 1} 章 word_count 不符` });
  }

  return { ok: violations.length === 0, violations };
}
