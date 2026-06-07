import fs from 'node:fs';
import path from 'node:path';
import { decodeTxtBuffer, detectTxtChapters } from '../server/src/ingest/chapterDetector.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const fileArg = args.find((arg) => !arg.startsWith('--'));

if (!fileArg || flags.has('--help') || flags.has('-h')) {
  console.log([
    'Usage: npm run chapter:probe -- /path/to/book.txt [--json] [--target=7000] [--max=10000]',
    '',
    'Preview TXT chapter detection only. It does not import books, write SQLite, or call AI.'
  ].join('\n'));
  process.exit(fileArg ? 0 : 1);
}

const bookPath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(bookPath)) {
  console.error(`找不到文件：${bookPath}`);
  process.exit(1);
}

const options = {
  fallbackTargetChars: numberFlag('--target=', 7000),
  fallbackMaxChars: numberFlag('--max=', 10000)
};

const text = decodeTxtBuffer(fs.readFileSync(bookPath));
const result = detectTxtChapters(text, options);

if (flags.has('--json')) {
  console.log(JSON.stringify({
    file: bookPath,
    strategy: result.strategy,
    chapters: result.chapters.map((chapter, index) => ({
      index: index + 1,
      title: chapter.title,
      charCount: chapter.charCount,
      source: chapter.source,
      score: chapter.score,
      preview: preview(chapter.content)
    })),
    diagnostics: result.diagnostics
  }, null, 2));
} else {
  console.log(`file=${bookPath}`);
  console.log(`strategy=${result.strategy}`);
  console.log(`chapters=${result.chapters.length}`);
  console.log(`chars=${result.diagnostics?.chars ?? text.length}`);
  console.log('');

  result.chapters.forEach((chapter, index) => {
    const num = String(index + 1).padStart(3, '0');
    console.log(`${num}. ${chapter.title}`);
    console.log(`     chars=${chapter.charCount} source=${chapter.source} score=${chapter.score}`);
    console.log(`     ${preview(chapter.content)}`);
  });
}

function numberFlag(prefix, fallback) {
  const item = args.find((arg) => arg.startsWith(prefix));
  if (!item) return fallback;
  const value = Number(item.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function preview(content) {
  return String(content || '').replace(/\s+/g, ' ').slice(0, 72);
}
