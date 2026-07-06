import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadArtifact } from '../paths.js';
import { regexSplit, runSplit } from './split.js';

describe('regexSplit（兜底分章）', () => {
  it('识别 Chapter/罗马数字/中文章回标题行', () => {
    const chapters = regexSplit([
      'front matter ignored',
      'Chapter 1 Alpha', 'line a1', '', 'line a2',
      'II. Beta', 'line b1',
      '第三章 收网', 'line c1'
    ].join('\n'));
    expect(chapters.length).toBe(3);
    expect(chapters[0].title).toBe('Chapter 1 Alpha');
    expect(chapters[0].content).toContain('line a2');
    expect(chapters[1].title).toBe('II. Beta');
    expect(chapters[2].title).toBe('第三章 收网');
  });

  it('无标题行时返回空数组', () => {
    expect(regexSplit('just prose\nno headings')).toEqual([]);
  });
});

describe('runSplit', () => {
  let tempDir;
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('把原文 txt 分章并写入 artifacts', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-split-'));
    vi.stubEnv('PACK_PRODUCER_WORK_DIR', tempDir);
    const src = path.join(tempDir, 'book.txt');
    fs.writeFileSync(src, [
      'Chapter 1 The Beginning', '', 'Alpha paragraph one.', '',
      'Chapter 2 The End', '', 'Beta paragraph two.'
    ].join('\n'));

    const meta = runSplit({ slug: 'demo', srcPath: src, lang: 'en', title: '示例书', author: '示例作者' });

    expect(meta).toMatchObject({ slug: 'demo', lang: 'en', title: '示例书', author: '示例作者', total_chapters: 2 });
    const chapters = loadArtifact('demo', 'chapters.src');
    expect(chapters.length).toBe(2);
    expect(chapters[0]).toMatchObject({ idx: 0 });
    expect(chapters[0].content).toContain('Alpha');
    expect(loadArtifact('demo', 'meta').total_chapters).toBe(2);
  });
});
