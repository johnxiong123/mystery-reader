import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveArtifact } from '../paths.js';
import { runQa } from './qa.js';

describe('runQa', () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-qa-'));
    vi.stubEnv('PACK_PRODUCER_WORK_DIR', tempDir);
    saveArtifact('demo', 'meta', { slug: 'demo', lang: 'en', title: 'T', author: 'A', total_chapters: 1 });
    saveArtifact('demo', 'glossary', { lang: 'en', entries: [
      { term: 'Holmes', zh: '福尔摩斯', type: 'person', count: 5 },
      { term: 'Baker Street', zh: '贝克街', type: 'place', count: 1 }
    ] });
    saveArtifact('demo', 'chapters.zh', [
      { idx: 0, title: '一', content: '福尔摩斯站在门口。', word_count: 9 }
    ]);
    saveArtifact('demo', 'dossier', {
      characters: [{ id: 1, name: '福尔摩斯', aliases: [], identity: '侦探', first_seen_chapter: 0 }],
      relationships: [], events: [], extracted_upto: 0
    });
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('干净数据全部通过', () => {
    expect(runQa({ slug: 'demo' })).toEqual({ ok: true, violations: [] });
  });

  it('检出拉丁残留、越界章号、缺失译名', () => {
    saveArtifact('demo', 'chapters.zh', [
      { idx: 0, title: '一', content: '他说 Watson 跟我来。', word_count: 12 }
    ]);
    saveArtifact('demo', 'dossier', {
      characters: [{ id: 1, name: '福尔摩斯', aliases: [], identity: null, first_seen_chapter: 5 }],
      relationships: [{ id: 2, from_char_id: 1, to_char_id: 99, type: 'x', reveal_chapter: 0, description: 'd' }],
      events: [], extracted_upto: 0
    });
    const result = runQa({ slug: 'demo' });
    expect(result.ok).toBe(false);
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain('foreign-residue');
    expect(rules).toContain('glossary-consistency');
    expect(rules).toContain('dossier-bounds');
  });

  it('word_count 不符检出；allow 白名单放行残留', () => {
    saveArtifact('demo', 'chapters.zh', [
      { idx: 0, title: '一', content: '福尔摩斯看着 GPS 定位。', word_count: 999 }
    ]);
    const result = runQa({ slug: 'demo', allow: ['GPS'] });
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain('chapters-integrity');
    expect(rules).not.toContain('foreign-residue');
  });
});
