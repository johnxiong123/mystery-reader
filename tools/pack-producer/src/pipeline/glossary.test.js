import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadArtifact, saveArtifact } from '../paths.js';
import { runGlossary } from './glossary.js';

describe('runGlossary', () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-glossary-'));
    vi.stubEnv('PACK_PRODUCER_WORK_DIR', tempDir);
    saveArtifact('demo', 'meta', { slug: 'demo', lang: 'en', title: 'T', author: 'A', total_chapters: 2 });
    saveArtifact('demo', 'chapters.src', [
      { idx: 0, title: 'One', content: 'Holmes met Watson in London.' },
      { idx: 1, title: 'Two', content: 'Holmes smiled. Watson nodded.' }
    ]);
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function fakeAi() {
    const chatJson = vi.fn()
      // 每章一次采词
      .mockResolvedValueOnce({ terms: [{ term: 'Holmes', type: 'person' }, { term: 'Watson', type: 'person' }, { term: 'London', type: 'place' }] })
      .mockResolvedValueOnce({ terms: [{ term: 'Holmes', type: 'person' }, { term: 'Watson', type: 'person' }] })
      // 一次统一译名
      .mockResolvedValueOnce({ entries: [
        { term: 'Holmes', zh: '福尔摩斯', type: 'person' },
        { term: 'Watson', zh: '华生', type: 'person' },
        { term: 'London', zh: '伦敦', type: 'place' }
      ] });
    return { chatJson };
  }

  it('两阶段生成术语表并按词频计数', async () => {
    const glossary = await runGlossary({ slug: 'demo', ai: fakeAi() });
    expect(glossary.lang).toBe('en');
    const holmes = glossary.entries.find((e) => e.term === 'Holmes');
    expect(holmes).toMatchObject({ zh: '福尔摩斯', type: 'person', count: 2 });
    expect(loadArtifact('demo', 'glossary').entries.length).toBe(3);
  });

  it('已有 glossary 时幂等跳过（保护人工修改）', async () => {
    saveArtifact('demo', 'glossary', { lang: 'en', entries: [{ term: 'Holmes', zh: '霍姆斯', type: 'person', count: 2 }] });
    const ai = fakeAi();
    const glossary = await runGlossary({ slug: 'demo', ai });
    expect(glossary.entries[0].zh).toBe('霍姆斯');
    expect(ai.chatJson).not.toHaveBeenCalled();
  });
});
