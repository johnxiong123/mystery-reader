import { decodeTxtBuffer, detectTxtChapters } from './chapterDetector.js';

export function parseTxt(buffer, filename = 'untitled.txt') {
  const content = decodeTxtBuffer(buffer).trim();
  if (!content) throw new Error('TXT 文件内容为空。');

  const detected = detectTxtChapters(content);
  return {
    title: filename.replace(/\.[^.]+$/, '') || '未命名 TXT',
    author: null,
    chapters: detected.chapters.map((chapter) => ({
      title: chapter.title,
      content: chapter.content
    }))
  };
}
