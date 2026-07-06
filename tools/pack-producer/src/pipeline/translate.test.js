import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadArtifact, saveArtifact } from '../paths.js';
import { chunkParagraphs, runTranslate } from './translate.js';

describe('chunkParagraphs', () => {
  it('按段落聚合到上限，超长段硬切', () => {
    const content = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(120)].join('\n\n');
    const chunks = chunkParagraphs(content, 100);
    // a+b 拼接含分隔符=102>100 → [a]，b 进 current；c=120 超长 → 先落 b，再把 c 硬切成 100+20
    expect(chunks.length).toBe(4);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });
});

describe('runTranslate', () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-translate-'));
    vi.stubEnv('PACK_PRODUCER_WORK_DIR', tempDir);
    saveArtifact('demo', 'meta', { slug: 'demo', lang: 'en', title: 'T', author: 'A', total_chapters: 2 });
    saveArtifact('demo', 'chapters.src', [
      { idx: 0, title: 'One', content: 'Holmes met Watson.' },
      { idx: 1, title: 'Two', content: 'They walked in London.' }
    ]);
    saveArtifact('demo', 'glossary', { lang: 'en', entries: [
      { term: 'Holmes', zh: '福尔摩斯', type: 'person', count: 2 },
      { term: 'Watson', zh: '华生', type: 'person', count: 1 },
      { term: 'London', zh: '伦敦', type: 'place', count: 1 }
    ] });
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('逐章翻译（标题+正文），word_count=译文长度，术语注入只含本段出现的词', async () => {
    const chatText = vi.fn()
      .mockResolvedValueOnce('第一章')            // 章 0 标题
      .mockResolvedValueOnce('福尔摩斯见到了华生。') // 章 0 正文
      .mockResolvedValueOnce('第二章')            // 章 1 标题
      .mockResolvedValueOnce('他们走在伦敦街头。'); // 章 1 正文
    await runTranslate({ slug: 'demo', ai: { chatText } });

    const zh = loadArtifact('demo', 'chapters.zh');
    expect(zh.length).toBe(2);
    expect(zh[0]).toMatchObject({ idx: 0, title: '第一章', content: '福尔摩斯见到了华生。' });
    expect(zh[0].word_count).toBe(zh[0].content.length);
    // 章0正文调用注入的术语只含 Holmes/Watson，不含 London
    const chapter0Body = chatText.mock.calls[1][0];
    const sys = chapter0Body.find((m) => m.role === 'system').content;
    expect(sys).toContain('福尔摩斯');
    expect(sys).not.toContain('伦敦');
  });

  it('断点续跑：已译章节跳过', async () => {
    saveArtifact('demo', 'chapters.zh', [{ idx: 0, title: '第一章', content: '已译内容', word_count: 4 }]);
    const chatText = vi.fn()
      .mockResolvedValueOnce('第二章')
      .mockResolvedValueOnce('他们走在伦敦街头。');
    await runTranslate({ slug: 'demo', ai: { chatText } });
    const zh = loadArtifact('demo', 'chapters.zh');
    expect(zh.length).toBe(2);
    expect(zh[0].content).toBe('已译内容');
    expect(chatText).toHaveBeenCalledTimes(2);
  });
});
