import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readJson, saveArtifact } from '../paths.js';
import { runPack } from './pack.js';

describe('runPack', () => {
  let tempWork;
  let tempPacks;
  beforeEach(() => {
    tempWork = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-pack-w-'));
    tempPacks = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-pack-p-'));
    vi.stubEnv('PACK_PRODUCER_WORK_DIR', tempWork);
    vi.stubEnv('PACK_PRODUCER_PACKS_DIR', tempPacks);
    saveArtifact('demo', 'meta', { slug: 'demo', lang: 'en', title: '示例', author: '某某', total_chapters: 1, public_domain_basis: '作者卒年 1930' });
    saveArtifact('demo', 'glossary', { lang: 'en', entries: [] });
    saveArtifact('demo', 'chapters.zh', [{ idx: 0, title: '一', content: '正文内容。', word_count: 5 }]);
    saveArtifact('demo', 'dossier', { characters: [], relationships: [], events: [], extracted_upto: 0 });
  });
  afterEach(() => {
    fs.rmSync(tempWork, { recursive: true, force: true });
    fs.rmSync(tempPacks, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('QA 通过后写出 pack 四件套并更新 index', () => {
    runPack({ slug: 'demo' });
    const manifest = readJson(path.join(tempPacks, 'demo/manifest.json'));
    expect(manifest).toMatchObject({ packVersion: 1, slug: 'demo', title: '示例', total_chapters: 1, total_words: 5, translator: 'AI 翻译', public_domain_basis: '作者卒年 1930' });
    expect(readJson(path.join(tempPacks, 'demo/chapters.json')).length).toBe(1);
    expect(readJson(path.join(tempPacks, 'demo/dossier.json')).characters).toEqual([]);
    const index = readJson(path.join(tempPacks, 'index.json'));
    expect(index).toEqual([{ slug: 'demo', title: '示例', author: '某某', total_chapters: 1, total_words: 5 }]);
  });

  it('QA 失败时抛错且不写包', () => {
    saveArtifact('demo', 'chapters.zh', [{ idx: 0, title: '一', content: 'Watson 残留了。', word_count: 11 }]);
    expect(() => runPack({ slug: 'demo' })).toThrow(/QA/);
    expect(fs.existsSync(path.join(tempPacks, 'demo/manifest.json'))).toBe(false);
  });
});
