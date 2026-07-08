import fs from 'node:fs';
import { parseTxt } from '../../../../server/src/ingest/parseTxt.js';
import { saveArtifact } from '../paths.js';

const SUPPORTED_LANGS = new Set(['en', 'ja', 'fr']);
// 罗马数字标题要求后面跟标题文字（"I. A SCANDAL..."），避免把故事内部的裸小节标记（单独一行 "I."）误判为章
const CHAPTER_HEADING = /^(Chapter|CHAPTER|第[一二三四五六七八九十百\d]+[章回])\s?|^[IVXLC]+\.\s+\S/;

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

  // 本工具只处理外文原著（en/ja/fr）：parseTxt 的中文标题检测对外文失效时会退化成
  // 均匀切"第 N 段"，因此外文标题正则能切出真实章节（>=2）时优先用正则结果。
  const headingChapters = regexSplit(buffer.toString('utf-8'));
  if (headingChapters.length >= 2) {
    parsed = { title: parsed.title, author: parsed.author, chapters: headingChapters };
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
