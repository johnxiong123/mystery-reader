import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as paths from './paths.js';

describe('paths', () => {
  let tempDir;
  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('writeJson 自动建目录，readJson 读回一致，缺失返回 null', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-paths-'));
    const file = path.join(tempDir, 'a/b/c.json');
    paths.writeJson(file, { x: 1, 中文: '值' });
    expect(paths.readJson(file)).toEqual({ x: 1, 中文: '值' });
    expect(paths.readJson(path.join(tempDir, 'nope.json'))).toBeNull();
  });

  it('artifact 存取按 slug 隔离', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-art-'));
    vi.stubEnv('PACK_PRODUCER_WORK_DIR', tempDir);
    paths.saveArtifact('book-a', 'chapters.src', [{ idx: 0 }]);
    expect(paths.loadArtifact('book-a', 'chapters.src')).toEqual([{ idx: 0 }]);
    expect(paths.loadArtifact('book-b', 'chapters.src')).toBeNull();
  });
});
