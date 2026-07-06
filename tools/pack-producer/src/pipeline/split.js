import fs from 'node:fs';
import { parseTxt } from '../../../../server/src/ingest/parseTxt.js';
import { saveArtifact } from '../paths.js';

const SUPPORTED_LANGS = new Set(['en', 'ja', 'fr']);
const CHAPTER_HEADING = /^(Chapter|CHAPTER|第[一二三四五六七八九十百\d]+[章回]|[IVXLC]+\.)\s?/;

export function regexSplit(content) {
  const chapters = [];
  let current = null;
  for (const line of content.split('\n')) {
    if (CHAPTER_HEADING.test(line)) {
      if (current) chapters.push(current);
      current = { title: line.trim(), content: '' };
    } else if (current) {
      current.content += (current.content ? '\n' : '') + line;
    }
  }
  if (current) chapters.push(current);
  return chapters;
}

export function runSplit({ slug, srcPath, lang, title, author }) {
  if (!slug) throw new Error('缺少 --book <slug>');
  if (!SUPPORTED_LANGS.has(lang)) throw new Error(`--lang 必须是 en/ja/fr，收到: ${lang}`);

  const buffer = fs.readFileSync(srcPath);
  let parsed = parseTxt(buffer, `${slug}.txt`);

  // 中文分章器对外文书最常见的失败模式是整本挤成 1 章（而非 0 章），
  // 因此 <=1 章即尝试正则兜底，谁切出的章多用谁。
  if (parsed.chapters.length <= 1) {
    const fallbackChapters = regexSplit(buffer.toString('utf-8'));
    if (fallbackChapters.length > parsed.chapters.length) {
      parsed = { title: parsed.title, author: parsed.author, chapters: fallbackChapters };
    }
  }

  if (!parsed.chapters.length) throw new Error('未解析到有效章节。');

  const chapters = parsed.chapters.map((chapter, idx) => ({
    idx,
    title: chapter.title || `Chapter ${idx + 1}`,
    content: chapter.content
  }));

  const meta = {
    slug,
    lang,
    title: title || parsed.title,
    author: author || parsed.author || null,
    total_chapters: chapters.length
  };

  saveArtifact(slug, 'chapters.src', chapters);
  saveArtifact(slug, 'meta', meta);
  return meta;
}
