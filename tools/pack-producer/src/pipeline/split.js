import fs from 'node:fs';
import { parseTxt } from '../../../../server/src/ingest/parseTxt.js';
import { saveArtifact } from '../paths.js';

const SUPPORTED_LANGS = new Set(['en', 'ja', 'fr']);

export function runSplit({ slug, srcPath, lang, title, author }) {
  if (!slug) throw new Error('缺少 --book <slug>');
  if (!SUPPORTED_LANGS.has(lang)) throw new Error(`--lang 必须是 en/ja/fr，收到: ${lang}`);

  const buffer = fs.readFileSync(srcPath);
  let parsed = parseTxt(buffer, `${slug}.txt`);

  // Regex fallback if server parser doesn't detect chapters properly
  if (!parsed.chapters.length) {
    const content = buffer.toString('utf-8');
    const lines = content.split('\n');
    const chapters = [];
    let currentChapter = null;

    const chapterRegex = /^(Chapter|CHAPTER|第[一二三四五六七八九十百\d]+[章回]|[IVXLC]+\.)\s?/;

    for (const line of lines) {
      if (chapterRegex.test(line)) {
        if (currentChapter) {
          chapters.push(currentChapter);
        }
        currentChapter = {
          title: line.trim(),
          content: ''
        };
      } else if (currentChapter) {
        currentChapter.content += (currentChapter.content ? '\n' : '') + line;
      }
    }

    if (currentChapter) {
      chapters.push(currentChapter);
    }

    if (chapters.length === 0) {
      throw new Error('未解析到有效章节。');
    }

    parsed = { title: title || 'Untitled', author: author || null, chapters };
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
