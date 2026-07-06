import { loadArtifact, saveArtifact } from '../paths.js';

const MAX_CHUNK = 2400;
const LANG_NAMES = { en: '英语', ja: '日语', fr: '法语' };

export function chunkParagraphs(content, maxChars = MAX_CHUNK) {
  const paragraphs = content.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function glossaryFor(text, entries) {
  return entries.filter((entry) => text.includes(entry.term));
}

function systemPrompt(lang, entries) {
  const lines = [
    `你是资深文学翻译，把${LANG_NAMES[lang]}小说译成流畅现代中文。`,
    '要求：忠实原文不增删情节；保留段落划分（空行分段）；对话用中文引号「」或""；',
    '只输出译文本身，不要任何解释、注释或原文。'
  ];
  if (entries.length) {
    lines.push('专名必须严格使用以下译名（不得自行改译）：');
    lines.push(entries.map((e) => `${e.term} → ${e.zh}`).join('；'));
  }
  return lines.join('\n');
}

export async function runTranslate({ slug, ai, from = null }) {
  const meta = loadArtifact(slug, 'meta');
  const src = loadArtifact(slug, 'chapters.src');
  const glossary = loadArtifact(slug, 'glossary');
  if (!meta || !src || !glossary) throw new Error('请先执行 split 与 glossary 步骤。');

  const done = new Map((loadArtifact(slug, 'chapters.zh') || []).map((c) => [c.idx, c]));
  for (const chapter of src) {
    if (from != null && chapter.idx >= from) done.delete(chapter.idx);
    if (done.has(chapter.idx)) continue;

    const titleEntries = glossaryFor(chapter.title, glossary.entries);
    const zhTitle = (await ai.chatText([
      { role: 'system', content: systemPrompt(meta.lang, titleEntries) },
      { role: 'user', content: `翻译这个章节标题：${chapter.title}` }
    ])).trim();

    const parts = [];
    for (const chunk of chunkParagraphs(chapter.content)) {
      const entries = glossaryFor(chunk, glossary.entries);
      const zh = await ai.chatText([
        { role: 'system', content: systemPrompt(meta.lang, entries) },
        { role: 'user', content: chunk }
      ]);
      parts.push(zh.trim());
    }
    const content = parts.join('\n\n');
    done.set(chapter.idx, { idx: chapter.idx, title: zhTitle, content, word_count: content.length });
    saveArtifact(slug, 'chapters.zh', [...done.values()].sort((a, b) => a.idx - b.idx));
    console.log(`[translate] ${slug} 第 ${chapter.idx + 1}/${src.length} 章完成`);
  }
  return loadArtifact(slug, 'chapters.zh');
}
