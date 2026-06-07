import fs from 'node:fs';
import epub2 from 'epub2';

const EPub = epub2.EPub || epub2.default || epub2;

export function parseEpub(filePath) {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    epub.on('error', reject);
    epub.on('end', async () => {
      try {
        const metadata = epub.metadata || {};
        const flow = epub.flow || [];
        const chapters = [];

        for (const item of flow) {
          const html = await getChapter(epub, item.id);
          const text = stripHtml(html).trim();
          if (text) {
            chapters.push({
              title: item.title || `第 ${chapters.length + 1} 章`,
              content: text
            });
          }
        }

        if (chapters.length === 0) throw new Error('EPUB 未解析到有效章节。');

        resolve({
          title: metadata.title || filePath.split(/[\\/]/).pop()?.replace(/\.epub$/i, '') || '未命名 EPUB',
          author: metadata.creator || metadata.author || null,
          chapters
        });
      } catch (error) {
        reject(error);
      }
    });

    if (!fs.existsSync(filePath)) {
      reject(new Error('EPUB 文件不存在。'));
      return;
    }
    epub.parse();
  });
}

function getChapter(epub, id) {
  return new Promise((resolve, reject) => {
    epub.getChapter(id, (error, text) => {
      if (error) reject(error);
      else resolve(text || '');
    });
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n');
}
