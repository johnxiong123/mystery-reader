import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadArtifact, saveArtifact } from '../paths.js';
import { createDossierStore, runExtract } from './extract.js';

describe('createDossierStore', () => {
  it('人物按名字/别名去重合并，关系无向去重，事件记录 reveal 章', () => {
    const store = createDossierStore();
    store.merge(0, {
      characters: [{ name: '福尔摩斯', aliases: ['歇洛克'], identity: '侦探' }],
      relationships: [],
      events: []
    });
    store.merge(1, {
      characters: [{ name: '歇洛克', aliases: [], identity: null }], // 命中别名 → 不新建
      relationships: [{ from: '福尔摩斯', to: '华生', type: '朋友', description: '同住' }],
      events: [{ description: '案发', occur_chapter: 0, involved: ['福尔摩斯'] }]
    });
    store.merge(2, {
      characters: [],
      relationships: [{ from: '华生', to: '福尔摩斯', type: '朋友', description: '反向重复' }], // 无向重复 → 忽略
      events: []
    });
    const json = store.toJson();
    expect(json.characters.length).toBe(2);
    const holmes = json.characters.find((c) => c.name === '福尔摩斯');
    expect(holmes.first_seen_chapter).toBe(0);
    expect(json.relationships.length).toBe(1);
    expect(json.relationships[0].reveal_chapter).toBe(1);
    expect(json.events[0]).toMatchObject({ occur_chapter: 0, reveal_chapter: 1, involved: [holmes.id] });
  });

  it('快照恢复后 id 连续', () => {
    const store = createDossierStore();
    store.merge(0, { characters: [{ name: 'A', aliases: [], identity: null }], relationships: [], events: [] });
    const restored = createDossierStore(store.toJson());
    restored.merge(1, { characters: [{ name: 'B', aliases: [], identity: null }], relationships: [], events: [] });
    const ids = restored.toJson().characters.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('runExtract', () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-extract-'));
    vi.stubEnv('PACK_PRODUCER_WORK_DIR', tempDir);
    saveArtifact('demo', 'chapters.zh', [
      { idx: 0, title: '一', content: '福尔摩斯登场。', word_count: 7 },
      { idx: 1, title: '二', content: '华生登场。', word_count: 5 }
    ]);
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('逐章抽取并写 dossier；断点续跑从 extracted_upto+1 开始', async () => {
    const chatJson = vi.fn()
      .mockResolvedValueOnce({ characters: [{ name: '福尔摩斯', aliases: [], identity: '侦探' }], relationships: [], events: [] })
      .mockResolvedValueOnce({ characters: [{ name: '华生', aliases: [], identity: '医生' }], relationships: [], events: [] });
    await runExtract({ slug: 'demo', ai: { chatJson } });
    let dossier = loadArtifact('demo', 'dossier');
    expect(dossier.characters.length).toBe(2);
    expect(dossier.extracted_upto).toBe(1);

    // 再跑一遍：无新章，AI 不再被调用
    await runExtract({ slug: 'demo', ai: { chatJson } });
    expect(chatJson).toHaveBeenCalledTimes(2);
  });
});
