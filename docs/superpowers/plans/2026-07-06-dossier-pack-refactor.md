# 「卷宗包」重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 mystery-reader 拆成「内容生产 CLI（维护者离线跑）+ 静态卷宗包 + 零门槛 Web 阅读端」，读者打开网页即读，无安装/无 Key/无自备书源。

**Architecture:** 三部分：`tools/pack-producer`（分章→术语表→AI 翻译→AI 抽取→质检→出包，五步幂等可断点续跑）；`packs/`（静态 JSON 卷宗包，字段语义与现有 SQLite 完全一致）；`web/` 加 DataSource 适配层（`ApiDataSource` 包装现有 api.js 行为不变，`PackDataSource` 读静态包 + 前端防剧透过滤），Vite 双模式构建，静态版部署 GitHub Pages。`server/` 零改动。

**Tech Stack:** Node ≥20、openai SDK（复用 server 依赖）、React 18 + Vite、vitest（server/web 均已有）、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-07-06-dossier-pack-refactor-design.md`

## Global Constraints

- **`server/` 目录一行都不改**（本地全栈模式回归验收：后端 36 测试全绿）。
- 不新增任何 npm 依赖（openai 已有；CLI 参数手写解析，不引 commander）。
- 卷宗包字段语义与 SQLite schema 一致：`first_seen_chapter` / `reveal_chapter` / `occur_chapter` / `involved_char_ids→involved` 含义不变。
- 防剧透 0 容忍：任何输出（含章节标题、搜索片段）不得包含 `> upto` 的内容。
- 译名一致性 0 容忍：质检不过阻断出包。
- 首发书目作者卒年 ≤1965（阿加莎 1976 年卒，中国保护期至 2026-12-31，**排除**）。
- 提交信息英文 `type(scope): description`，尾行 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 测试命令：producer `cd tools/pack-producer && npx vitest run`；web `cd web && npx vitest run`；server 回归 `cd server && npx vitest run`。

## File Structure

```
tools/pack-producer/
  package.json                 新 workspace（name: @mystery-reader/pack-producer）
  src/cli.js                   命令入口（split|glossary|translate|extract|qa|pack）
  src/paths.js                 workdir/packdir 路径 + JSON 读写
  src/ai.js                    AI 客户端包装（复用 server config/client，JSON 重试）
  src/pipeline/split.js        步骤1 分章（复用 server parseTxt）
  src/pipeline/glossary.js     步骤2 术语表（两阶段：采词→统一译名）
  src/pipeline/translate.js    步骤3 逐章翻译（术语注入、分块、断点续跑）
  src/pipeline/extract.js      步骤4 抽取（复用 server prompt.js；内存版 dossier store）
  src/pipeline/qa.js           步骤5 质检（外文残留/术语一致/字段完整）
  src/pipeline/*.test.js       各步骤单测
  work/                        中间产物（gitignore）
packs/
  index.json                   书目索引
  <slug>/manifest.json|chapters.json|dossier.json|glossary.json
web/src/data/
  index.js                     数据源工厂（VITE_DATA_MODE 切换，export const api）
  ApiDataSource.js             包装现有 api.js + capabilities
  PackDataSource.js            静态包实现 + capabilities
  spoilerFilter.js             防剧透纯函数（从 server 逐条移植）
  spoilerFilter.test.js
  localProgress.js             localStorage 进度/书签
  localProgress.test.js
  PackDataSource.test.js
.github/workflows/deploy-pages.yml   静态版部署
```

---

# Part A · 子项目①：卷宗包格式 + pack-producer CLI

### Task 1: workspace 脚手架 + 路径/JSON 模块

**Files:**
- Modify: `package.json`（根，workspaces 加 `"tools/pack-producer"`）
- Create: `tools/pack-producer/package.json`
- Create: `tools/pack-producer/src/paths.js`
- Create: `tools/pack-producer/.gitignore`（内容一行：`work/`）
- Test: `tools/pack-producer/src/paths.test.js`

**Interfaces:**
- Produces: `paths.js` 导出 `workDir(slug)`、`packDir(slug)`、`packsRoot()`、`readJson(file)`（不存在返回 `null`）、`writeJson(file, data)`（自动建目录，2 空格缩进）、`loadArtifact(slug, name)`、`saveArtifact(slug, name, data)`（artifact 存于 `work/<slug>/<name>.json`）。

- [ ] **Step 1: 根 package.json 的 workspaces 改为**

```json
  "workspaces": [
    "server",
    "web",
    "tools/pack-producer"
  ],
```

- [ ] **Step 2: 新建 `tools/pack-producer/package.json`**

```json
{
  "name": "@mystery-reader/pack-producer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.1"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: 写失败测试 `tools/pack-producer/src/paths.test.js`**

```js
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
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npm install && cd tools/pack-producer && npx vitest run src/paths.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 5: 实现 `tools/pack-producer/src/paths.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const producerRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(producerRoot, '../..');

export function workRoot() {
  return process.env.PACK_PRODUCER_WORK_DIR || path.join(producerRoot, 'work');
}

export function packsRoot() {
  return process.env.PACK_PRODUCER_PACKS_DIR || path.join(repoRoot, 'packs');
}

export function workDir(slug) {
  return path.join(workRoot(), slug);
}

export function packDir(slug) {
  return path.join(packsRoot(), slug);
}

export function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function loadArtifact(slug, name) {
  return readJson(path.join(workDir(slug), `${name}.json`));
}

export function saveArtifact(slug, name, data) {
  writeJson(path.join(workDir(slug), `${name}.json`), data);
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd tools/pack-producer && npx vitest run src/paths.test.js` → 2 passed

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json tools/pack-producer
git commit -m "feat(producer): scaffold pack-producer workspace with path helpers"
```

---

### Task 2: 分章步骤（split）

**Files:**
- Create: `tools/pack-producer/src/pipeline/split.js`
- Test: `tools/pack-producer/src/pipeline/split.test.js`

**Interfaces:**
- Consumes: `server/src/ingest/parseTxt.js` 的 `parseTxt(buffer, filename)` → `{ title, author, chapters: [{ title, content }] }`（既有代码，勿改）；Task 1 的 `saveArtifact`。
- Produces: `runSplit({ slug, srcPath, lang, title, author })` → 写 artifact `chapters.src` = `[{ idx, title, content }]` 与 `meta` = `{ slug, lang, title, author, total_chapters }`，并返回 meta。`lang ∈ 'en'|'ja'|'fr'`。

- [ ] **Step 1: 写失败测试 `split.test.js`**

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadArtifact } from '../paths.js';
import { runSplit } from './split.js';

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd tools/pack-producer && npx vitest run src/pipeline/split.test.js` → FAIL

- [ ] **Step 3: 实现 `split.js`**

```js
import fs from 'node:fs';
import { parseTxt } from '../../../../server/src/ingest/parseTxt.js';
import { saveArtifact } from '../paths.js';

const SUPPORTED_LANGS = new Set(['en', 'ja', 'fr']);

export function runSplit({ slug, srcPath, lang, title, author }) {
  if (!slug) throw new Error('缺少 --book <slug>');
  if (!SUPPORTED_LANGS.has(lang)) throw new Error(`--lang 必须是 en/ja/fr，收到: ${lang}`);
  const buffer = fs.readFileSync(srcPath);
  const parsed = parseTxt(buffer, `${slug}.txt`);
  if (!parsed.chapters.length) throw new Error('未解析到有效章节。');

  const chapters = parsed.chapters.map((chapter, idx) => ({
    idx,
    title: chapter.title || `Chapter ${idx + 1}`,
    content: chapter.content
  }));
  const meta = {
    slug,
    lang,
    title: title || parsed.title,
    author: author || parsed.author || null,
    total_chapters: chapters.length
  };
  saveArtifact(slug, 'chapters.src', chapters);
  saveArtifact(slug, 'meta', meta);
  return meta;
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd tools/pack-producer && npx vitest run src/pipeline/split.test.js` → PASS

```bash
git add tools/pack-producer/src/pipeline/split.js tools/pack-producer/src/pipeline/split.test.js
git commit -m "feat(producer): source splitting step reusing server txt parser"
```

> 注：`parseTxt` 对英文/日文分章的实际效果在子项目③首本书生产时验证；若分章检测对外文标题失效，允许在 split.js 内加**正则回退**（`/^(Chapter|CHAPTER|第[一二三四五六七八九十百\d]+[章回]|[IVXLC]+\.)\s/` 按行切），不得改 server 代码。

---

### Task 3: AI 客户端包装

**Files:**
- Create: `tools/pack-producer/src/ai.js`
- Test: `tools/pack-producer/src/ai.test.js`

**Interfaces:**
- Consumes: `server/src/config.js` 的 `getConfig()`（读根 .env 的 AI_API_KEY/AI_BASE_URL/AI_MODEL）；`server/src/ai/client.js` 的 `createAiClient(config)`。
- Produces: `createProducerAi(overrides?)` → `{ model, chatText(messages), chatJson(messages) }`。`chatText` 返回纯文本；`chatJson` 优先 `response_format: json_object`，遇不支持自动降级，均带 3 次重试。`overrides.client` 供测试注入 mock。

- [ ] **Step 1: 写失败测试 `ai.test.js`**

```js
import { describe, expect, it, vi } from 'vitest';
import { createProducerAi } from './ai.js';

function mockClient(responses) {
  const create = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) create.mockRejectedValueOnce(r);
    else create.mockResolvedValueOnce({ choices: [{ message: { content: r } }] });
  }
  return { client: { chat: { completions: { create } } }, create };
}

describe('createProducerAi', () => {
  it('chatJson 解析 JSON（含 ```json 围栏）', async () => {
    const { client } = mockClient(['```json\n{"a":1}\n```']);
    const ai = createProducerAi({ client, model: 'test-model' });
    expect(await ai.chatJson([{ role: 'user', content: 'x' }])).toEqual({ a: 1 });
  });

  it('response_format 不支持时降级重试', async () => {
    const err = Object.assign(new Error('response_format is unsupported'), { status: 400 });
    const { client, create } = mockClient([err, '{"ok":true}']);
    const ai = createProducerAi({ client, model: 'test-model' });
    expect(await ai.chatJson([{ role: 'user', content: 'x' }])).toEqual({ ok: true });
    expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
    expect(create.mock.calls[1][0].response_format).toBeUndefined();
  });

  it('连续失败 3 次后抛错', async () => {
    const boom = new Error('rate limited');
    const { client } = mockClient([boom, boom, boom]);
    const ai = createProducerAi({ client, model: 'test-model' });
    await expect(ai.chatText([{ role: 'user', content: 'x' }])).rejects.toThrow('rate limited');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL（模块不存在）

- [ ] **Step 3: 实现 `ai.js`**

```js
import { getConfig } from '../../../server/src/config.js';
import { createAiClient } from '../../../server/src/ai/client.js';
import { isUnsupportedResponseFormatError } from '../../../server/src/ingest/extractor.js';

const RETRIES = 3;

export function createProducerAi(overrides = {}) {
  let client = overrides.client;
  let model = overrides.model;
  if (!client) {
    const config = getConfig();
    if (!config.ai.apiKey) throw new Error('缺少 AI_API_KEY（根目录 .env）。');
    client = createAiClient(config);
    model = model || config.ai.model;
  }
  let jsonModeAvailable = true;

  async function call(messages, { jsonMode }) {
    const request = { model, messages };
    if (jsonMode) request.response_format = { type: 'json_object' };
    const completion = await client.chat.completions.create(request);
    return completion.choices?.[0]?.message?.content || '';
  }

  async function withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  return {
    model,
    chatText: (messages) => withRetry(() => call(messages, { jsonMode: false })),
    chatJson: (messages) => withRetry(async () => {
      try {
        return parseJson(await call(messages, { jsonMode: jsonModeAvailable }));
      } catch (error) {
        if (jsonModeAvailable && isUnsupportedResponseFormatError(error)) {
          jsonModeAvailable = false;
          return parseJson(await call(messages, { jsonMode: false }));
        }
        throw error;
      }
    })
  };
}

function parseJson(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd tools/pack-producer && npx vitest run src/ai.test.js` → 3 passed

```bash
git add tools/pack-producer/src/ai.js tools/pack-producer/src/ai.test.js
git commit -m "feat(producer): ai wrapper reusing server config and client with json fallback"
```

---

### Task 4: 术语表步骤（glossary）

**Files:**
- Create: `tools/pack-producer/src/pipeline/glossary.js`
- Test: `tools/pack-producer/src/pipeline/glossary.test.js`

**Interfaces:**
- Consumes: artifact `chapters.src`、`meta`；Task 3 的 `ai.chatJson`。
- Produces: `runGlossary({ slug, ai })` → 写 artifact `glossary` = `{ lang, entries: [{ term, zh, type, count }] }` 并返回。`type ∈ 'person'|'place'|'org'|'other'`。已存在 glossary artifact 时跳过（幂等；人工改过的译名不被覆盖），`--force` 才重跑。

- [ ] **Step 1: 写失败测试 `glossary.test.js`**

```js
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
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现 `glossary.js`**

```js
import { loadArtifact, saveArtifact } from '../paths.js';

const LANG_NAMES = { en: '英语', ja: '日语', fr: '法语' };

export async function runGlossary({ slug, ai, force = false }) {
  const existing = loadArtifact(slug, 'glossary');
  if (existing && !force) return existing;

  const meta = loadArtifact(slug, 'meta');
  const chapters = loadArtifact(slug, 'chapters.src');
  if (!meta || !chapters) throw new Error('请先执行 split 步骤。');

  // 阶段一：逐章采词
  const counts = new Map(); // term -> { type, count }
  for (const chapter of chapters) {
    const result = await ai.chatJson([
      {
        role: 'system',
        content: [
          `你是专有名词采集器。输入是一段${LANG_NAMES[meta.lang]}小说正文。`,
          '抽取其中的专有名词：人名(person)、地名(place)、机构名(org)、其他专名(other)。',
          '只输出 JSON：{"terms":[{"term":"原文专名","type":"person|place|org|other"}]}',
          '同一专名只出现一次；不要输出普通名词。'
        ].join('\n')
      },
      { role: 'user', content: chapter.content }
    ]);
    for (const item of result.terms || []) {
      if (!item?.term) continue;
      const key = item.term.trim();
      const entry = counts.get(key) || { type: item.type || 'other', count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }

  // 阶段二：统一译名（一次调用，保证全书唯一）
  const termList = [...counts.entries()].map(([term, { type }]) => ({ term, type }));
  const translated = await ai.chatJson([
    {
      role: 'system',
      content: [
        `你是文学翻译的译名规范师。给出${LANG_NAMES[meta.lang]}专名的标准中文译名。`,
        '规则：1) 已有通行译名的必须用通行译名（如 Sherlock Holmes→夏洛克·福尔摩斯）；',
        '2) 人名音译使用新华社译名风格；3) 同一专名只给一个译名。',
        '只输出 JSON：{"entries":[{"term":"原文","zh":"中文译名","type":"原样返回"}]}'
      ].join('\n')
    },
    { role: 'user', content: JSON.stringify({ book: meta.title, terms: termList }) }
  ]);

  const zhByTerm = new Map((translated.entries || []).map((e) => [e.term, e]));
  const glossary = {
    lang: meta.lang,
    entries: termList.map(({ term, type }) => ({
      term,
      zh: zhByTerm.get(term)?.zh || term,
      type: zhByTerm.get(term)?.type || type,
      count: counts.get(term).count
    }))
  };
  saveArtifact(slug, 'glossary', glossary);
  return glossary;
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd tools/pack-producer && npx vitest run src/pipeline/glossary.test.js` → 2 passed

```bash
git add tools/pack-producer/src/pipeline/glossary.js tools/pack-producer/src/pipeline/glossary.test.js
git commit -m "feat(producer): two-stage glossary generation with manual-edit protection"
```

---

### Task 5: 翻译步骤（translate）

**Files:**
- Create: `tools/pack-producer/src/pipeline/translate.js`
- Test: `tools/pack-producer/src/pipeline/translate.test.js`

**Interfaces:**
- Consumes: artifacts `chapters.src`/`meta`/`glossary`；`ai.chatText`。
- Produces: `runTranslate({ slug, ai, from })` → 写 artifact `chapters.zh` = `[{ idx, title, content, word_count }]`。**逐章增量保存**（每章译完立即写盘）；重跑时跳过已有章（`from` 指定起点强制重译）。导出 `chunkParagraphs(content, maxChars)` 供测试。

- [ ] **Step 1: 写失败测试 `translate.test.js`**

```js
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
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现 `translate.js`**

```js
import { loadArtifact, saveArtifact } from '../paths.js';

const MAX_CHUNK = 2400;
const LANG_NAMES = { en: '英语', ja: '日语', fr: '法语' };

export function chunkParagraphs(content, maxChars = MAX_CHUNK) {
  const paragraphs = content.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function glossaryFor(text, entries) {
  return entries.filter((entry) => text.includes(entry.term));
}

function systemPrompt(lang, entries) {
  const lines = [
    `你是资深文学翻译，把${LANG_NAMES[lang]}小说译成流畅现代中文。`,
    '要求：忠实原文不增删情节；保留段落划分（空行分段）；对话用中文引号「」或“”；',
    '只输出译文本身，不要任何解释、注释或原文。'
  ];
  if (entries.length) {
    lines.push('专名必须严格使用以下译名（不得自行改译）：');
    lines.push(entries.map((e) => `${e.term} → ${e.zh}`).join('；'));
  }
  return lines.join('\n');
}

export async function runTranslate({ slug, ai, from = null }) {
  const meta = loadArtifact(slug, 'meta');
  const src = loadArtifact(slug, 'chapters.src');
  const glossary = loadArtifact(slug, 'glossary');
  if (!meta || !src || !glossary) throw new Error('请先执行 split 与 glossary 步骤。');

  const done = new Map((loadArtifact(slug, 'chapters.zh') || []).map((c) => [c.idx, c]));
  for (const chapter of src) {
    if (from != null && chapter.idx >= from) done.delete(chapter.idx);
    if (done.has(chapter.idx)) continue;

    const titleEntries = glossaryFor(chapter.title, glossary.entries);
    const zhTitle = (await ai.chatText([
      { role: 'system', content: systemPrompt(meta.lang, titleEntries) },
      { role: 'user', content: `翻译这个章节标题：${chapter.title}` }
    ])).trim();

    const parts = [];
    for (const chunk of chunkParagraphs(chapter.content)) {
      const entries = glossaryFor(chunk, glossary.entries);
      const zh = await ai.chatText([
        { role: 'system', content: systemPrompt(meta.lang, entries) },
        { role: 'user', content: chunk }
      ]);
      parts.push(zh.trim());
    }
    const content = parts.join('\n\n');
    done.set(chapter.idx, { idx: chapter.idx, title: zhTitle, content, word_count: content.length });
    saveArtifact(slug, 'chapters.zh', [...done.values()].sort((a, b) => a.idx - b.idx));
    console.log(`[translate] ${slug} 第 ${chapter.idx + 1}/${src.length} 章完成`);
  }
  return loadArtifact(slug, 'chapters.zh');
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd tools/pack-producer && npx vitest run src/pipeline/translate.test.js` → 3 passed

```bash
git add tools/pack-producer/src/pipeline/translate.js tools/pack-producer/src/pipeline/translate.test.js
git commit -m "feat(producer): glossary-injected chapter translation with resume"
```

---

### Task 6: 抽取步骤（extract，内存版 dossier store）

**Files:**
- Create: `tools/pack-producer/src/pipeline/extract.js`
- Test: `tools/pack-producer/src/pipeline/extract.test.js`

**Interfaces:**
- Consumes: artifact `chapters.zh`；`server/src/ai/prompt.js` 的 `buildExtractionMessages({chapterIdx, content, knownCharacters})` 与 `validateExtractionJson(value, currentChapter)`（既有代码，勿改。注意 `knownCharacters` 元素的 `aliases` 是 **JSON 字符串**）；`ai.chatJson`。
- Produces: `createDossierStore(snapshot?)` → `{ knownCharacters(), merge(chapterIdx, extraction), toJson() }`；`runExtract({ slug, ai })` → 写 artifact `dossier` = `{ characters, relationships, events, extracted_upto }`（含断点续跑）。`toJson()` 的三数组字段与 SQLite 语义一致：characters `{id,name,aliases:[],identity,first_seen_chapter}`；relationships `{id,from_char_id,to_char_id,type,reveal_chapter,description}`；events `{id,description,occur_chapter,reveal_chapter,involved:[charId]}`。

- [ ] **Step 1: 写失败测试 `extract.test.js`**

```js
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
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现 `extract.js`**

```js
import { buildExtractionMessages, validateExtractionJson } from '../../../../server/src/ai/prompt.js';
import { loadArtifact, saveArtifact } from '../paths.js';

const MAX_CHARS = 12000;

export function createDossierStore(snapshot = null) {
  const characters = (snapshot?.characters || []).map((c) => ({ ...c, aliases: [...(c.aliases || [])] }));
  const relationships = [...(snapshot?.relationships || [])];
  const events = [...(snapshot?.events || [])];
  let nextId = Math.max(0, ...characters.map((c) => c.id), ...relationships.map((r) => r.id), ...events.map((e) => e.id)) + 1;

  const normalize = (value) => String(value || '').trim().toLocaleLowerCase();

  function findCharacter(name) {
    const n = normalize(name);
    return characters.find((c) => normalize(c.name) === n || c.aliases.some((a) => normalize(a) === n));
  }

  function ensureCharacter(name, patch = {}) {
    let existing = findCharacter(name);
    if (!existing) {
      existing = {
        id: nextId++,
        name: String(name).trim(),
        aliases: [...(patch.aliases || [])],
        identity: patch.identity || null,
        first_seen_chapter: patch.firstSeenChapter ?? 0
      };
      characters.push(existing);
      return existing;
    }
    for (const alias of patch.aliases || []) {
      if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
    }
    if (!existing.identity && patch.identity) existing.identity = patch.identity;
    return existing;
  }

  function merge(chapterIdx, extraction) {
    for (const char of extraction.characters) {
      ensureCharacter(char.name, { aliases: char.aliases, identity: char.identity, firstSeenChapter: chapterIdx });
    }
    for (const rel of extraction.relationships) {
      const from = ensureCharacter(rel.from, { firstSeenChapter: chapterIdx });
      const to = ensureCharacter(rel.to, { firstSeenChapter: chapterIdx });
      const exists = relationships.some((r) => r.type === rel.type &&
        ((r.from_char_id === from.id && r.to_char_id === to.id) || (r.from_char_id === to.id && r.to_char_id === from.id)));
      if (!exists) {
        relationships.push({ id: nextId++, from_char_id: from.id, to_char_id: to.id, type: rel.type, reveal_chapter: chapterIdx, description: rel.description });
      }
    }
    for (const event of extraction.events) {
      const involved = [...new Set(event.involved.map((name) => ensureCharacter(name, { firstSeenChapter: chapterIdx }).id))];
      events.push({ id: nextId++, description: event.description, occur_chapter: event.occur_chapter, reveal_chapter: chapterIdx, involved });
    }
  }

  return {
    merge,
    knownCharacters: () => characters.map((c) => ({ name: c.name, aliases: JSON.stringify(c.aliases) })),
    toJson: () => ({ characters, relationships, events })
  };
}

function splitContent(content) {
  if (content.length <= MAX_CHARS) return [content];
  const paragraphs = content.split(/\n{2,}/);
  const blocks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHARS) {
      if (current) { blocks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += MAX_CHARS) blocks.push(paragraph.slice(i, i + MAX_CHARS));
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHARS && current) { blocks.push(current); current = paragraph; }
    else current = next;
  }
  if (current) blocks.push(current);
  return blocks;
}

export async function runExtract({ slug, ai }) {
  const chapters = loadArtifact(slug, 'chapters.zh');
  if (!chapters) throw new Error('请先执行 translate 步骤。');

  const snapshot = loadArtifact(slug, 'dossier');
  const store = createDossierStore(snapshot);
  const startFrom = snapshot ? snapshot.extracted_upto + 1 : 0;

  for (const chapter of chapters) {
    if (chapter.idx < startFrom) continue;
    for (const block of splitContent(chapter.content)) {
      const raw = await ai.chatJson(buildExtractionMessages({
        chapterIdx: chapter.idx,
        content: block,
        knownCharacters: store.knownCharacters()
      }));
      store.merge(chapter.idx, validateExtractionJson(raw, chapter.idx));
    }
    saveArtifact(slug, 'dossier', { ...store.toJson(), extracted_upto: chapter.idx });
    console.log(`[extract] ${slug} 第 ${chapter.idx + 1}/${chapters.length} 章完成`);
  }
  return loadArtifact(slug, 'dossier');
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd tools/pack-producer && npx vitest run src/pipeline/extract.test.js` → 3 passed

```bash
git add tools/pack-producer/src/pipeline/extract.js tools/pack-producer/src/pipeline/extract.test.js
git commit -m "feat(producer): extraction step with in-memory dossier store and resume"
```

---

### Task 7: 质检步骤（qa）

**Files:**
- Create: `tools/pack-producer/src/pipeline/qa.js`
- Test: `tools/pack-producer/src/pipeline/qa.test.js`

**Interfaces:**
- Consumes: artifacts `meta`/`chapters.zh`/`glossary`/`dossier`。
- Produces: `runQa({ slug, allow })` → `{ ok, violations: [{ rule, detail }] }`。规则：
  1. `foreign-residue`：译文残留源语言文字（en/fr → 连续 ≥3 拉丁字母的词；ja → 任何平假名/片假名），`allow` 白名单放行；
  2. `glossary-consistency`：`count ≥ 3` 的术语其 `zh` 必须在全书译文出现；
  3. `dossier-bounds`：所有 `first_seen_chapter`/`reveal_chapter`/`occur_chapter` ∈ [0, total_chapters)；关系/事件引用的人物 id 必须存在；
  4. `chapters-integrity`：章节数 = meta.total_chapters、无空正文、`word_count === content.length`。

- [ ] **Step 1: 写失败测试 `qa.test.js`**

```js
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
    expect(rules).toContain('foreign-residue');       // Watson 残留
    expect(rules).toContain('glossary-consistency');  // 福尔摩斯 zh 未出现（count>=3）
    expect(rules).toContain('dossier-bounds');        // first_seen=5 越界 + to_char_id=99 不存在
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
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现 `qa.js`**

```js
import { loadArtifact } from '../paths.js';

export function runQa({ slug, allow = [] }) {
  const meta = loadArtifact(slug, 'meta');
  const chapters = loadArtifact(slug, 'chapters.zh');
  const glossary = loadArtifact(slug, 'glossary');
  const dossier = loadArtifact(slug, 'dossier');
  if (!meta || !chapters || !glossary || !dossier) throw new Error('缺少中间产物，请先完成前序步骤。');

  const violations = [];
  const allowSet = new Set(allow.map((a) => a.toLowerCase()));
  const fullText = chapters.map((c) => `${c.title}\n${c.content}`).join('\n');

  // 1. foreign-residue
  if (meta.lang === 'ja') {
    for (const chapter of chapters) {
      const hit = (`${chapter.title}${chapter.content}`).match(/[぀-ヿ]+/);
      if (hit) violations.push({ rule: 'foreign-residue', detail: `第 ${chapter.idx + 1} 章残留假名: ${hit[0]}` });
    }
  } else {
    for (const chapter of chapters) {
      for (const token of (`${chapter.title} ${chapter.content}`).match(/[A-Za-z]{3,}/g) || []) {
        if (!allowSet.has(token.toLowerCase())) {
          violations.push({ rule: 'foreign-residue', detail: `第 ${chapter.idx + 1} 章残留: ${token}` });
        }
      }
    }
  }

  // 2. glossary-consistency
  for (const entry of glossary.entries) {
    if (entry.count >= 3 && !fullText.includes(entry.zh)) {
      violations.push({ rule: 'glossary-consistency', detail: `高频术语「${entry.term}→${entry.zh}」未在译文出现` });
    }
  }

  // 3. dossier-bounds
  const total = meta.total_chapters;
  const charIds = new Set(dossier.characters.map((c) => c.id));
  for (const c of dossier.characters) {
    if (c.first_seen_chapter < 0 || c.first_seen_chapter >= total) {
      violations.push({ rule: 'dossier-bounds', detail: `人物「${c.name}」first_seen_chapter=${c.first_seen_chapter} 越界` });
    }
  }
  for (const r of dossier.relationships) {
    if (r.reveal_chapter < 0 || r.reveal_chapter >= total) violations.push({ rule: 'dossier-bounds', detail: `关系 ${r.id} reveal 越界` });
    if (!charIds.has(r.from_char_id) || !charIds.has(r.to_char_id)) violations.push({ rule: 'dossier-bounds', detail: `关系 ${r.id} 引用不存在的人物` });
  }
  for (const e of dossier.events) {
    if (e.reveal_chapter < 0 || e.reveal_chapter >= total || e.occur_chapter < 0 || e.occur_chapter >= total) {
      violations.push({ rule: 'dossier-bounds', detail: `事件 ${e.id} 章号越界` });
    }
    for (const id of e.involved) {
      if (!charIds.has(id)) violations.push({ rule: 'dossier-bounds', detail: `事件 ${e.id} 引用不存在的人物 ${id}` });
    }
  }

  // 4. chapters-integrity
  if (chapters.length !== total) violations.push({ rule: 'chapters-integrity', detail: `章节数 ${chapters.length} ≠ meta ${total}` });
  for (const c of chapters) {
    if (!c.content?.trim()) violations.push({ rule: 'chapters-integrity', detail: `第 ${c.idx + 1} 章正文为空` });
    else if (c.word_count !== c.content.length) violations.push({ rule: 'chapters-integrity', detail: `第 ${c.idx + 1} 章 word_count 不符` });
  }

  return { ok: violations.length === 0, violations };
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd tools/pack-producer && npx vitest run src/pipeline/qa.test.js` → 3 passed

```bash
git add tools/pack-producer/src/pipeline/qa.js tools/pack-producer/src/pipeline/qa.test.js
git commit -m "feat(producer): qa gate (residue/glossary/bounds/integrity)"
```

---

### Task 8: 出包 + CLI 入口

**Files:**
- Create: `tools/pack-producer/src/pipeline/pack.js`
- Create: `tools/pack-producer/src/cli.js`
- Test: `tools/pack-producer/src/pipeline/pack.test.js`

**Interfaces:**
- Consumes: 全部前序 artifacts；`runQa`。
- Produces: `runPack({ slug, allow })` → QA 通过后写 `packs/<slug>/{manifest,chapters,dossier,glossary}.json` 并重建 `packs/index.json`；QA 失败抛错（阻断）。`manifest` = `{ packVersion: 1, slug, title, author, lang, translator: 'AI 翻译', public_domain_basis, total_chapters, total_words, created_at }`（`public_domain_basis` 由 meta 透传，split 时可用 `--pd "作者卒年 XXXX"` 传入，默认 `null`）。`index.json` = `[{ slug, title, author, total_chapters, total_words }]` 按 title 排序。CLI 用法：

```
node tools/pack-producer/src/cli.js split     --book <slug> --src <txt路径> --lang en|ja|fr [--title T] [--author A] [--pd 说明]
node tools/pack-producer/src/cli.js glossary  --book <slug> [--force]
node tools/pack-producer/src/cli.js translate --book <slug> [--from N]
node tools/pack-producer/src/cli.js extract   --book <slug>
node tools/pack-producer/src/cli.js qa        --book <slug> [--allow 词1,词2]
node tools/pack-producer/src/cli.js pack      --book <slug> [--allow 词1,词2]
```

- [ ] **Step 1: 写失败测试 `pack.test.js`**

```js
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
    expect(manifest).toMatchObject({ packVersion: 1, slug: 'demo', title: '示例', total_chapters: 1, total_words: 5, translator: 'AI 翻译' });
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
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现 `pack.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { loadArtifact, packDir, packsRoot, readJson, writeJson } from '../paths.js';
import { runQa } from './qa.js';

export function runPack({ slug, allow = [] }) {
  const qa = runQa({ slug, allow });
  if (!qa.ok) {
    const detail = qa.violations.slice(0, 10).map((v) => `[${v.rule}] ${v.detail}`).join('\n');
    throw new Error(`QA 未通过（${qa.violations.length} 项），阻断出包：\n${detail}`);
  }

  const meta = loadArtifact(slug, 'meta');
  const chapters = loadArtifact(slug, 'chapters.zh');
  const dossier = loadArtifact(slug, 'dossier');
  const glossary = loadArtifact(slug, 'glossary');
  const totalWords = chapters.reduce((sum, c) => sum + c.word_count, 0);

  const manifest = {
    packVersion: 1,
    slug,
    title: meta.title,
    author: meta.author,
    lang: meta.lang,
    translator: 'AI 翻译',
    public_domain_basis: meta.public_domain_basis || null,
    total_chapters: meta.total_chapters,
    total_words: totalWords,
    created_at: new Date().toISOString()
  };
  const dir = packDir(slug);
  writeJson(path.join(dir, 'manifest.json'), manifest);
  writeJson(path.join(dir, 'chapters.json'), chapters);
  writeJson(path.join(dir, 'dossier.json'), { characters: dossier.characters, relationships: dossier.relationships, events: dossier.events });
  writeJson(path.join(dir, 'glossary.json'), glossary);
  rebuildIndex();
  return manifest;
}

export function rebuildIndex() {
  const root = packsRoot();
  const entries = [];
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const manifest = readJson(path.join(root, name, 'manifest.json'));
      if (manifest) {
        entries.push({ slug: manifest.slug, title: manifest.title, author: manifest.author, total_chapters: manifest.total_chapters, total_words: manifest.total_words });
      }
    }
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  writeJson(path.join(root, 'index.json'), entries);
  return entries;
}
```

- [ ] **Step 4: 实现 `cli.js`**

```js
import { createProducerAi } from './ai.js';
import { runSplit } from './pipeline/split.js';
import { runGlossary } from './pipeline/glossary.js';
import { runTranslate } from './pipeline/translate.js';
import { runExtract } from './pipeline/extract.js';
import { runQa } from './pipeline/qa.js';
import { runPack } from './pipeline/pack.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const next = rest[i + 1];
      if (next != null && !next.startsWith('--')) { flags[key] = next; i += 1; }
      else flags[key] = true;
    }
  }
  return { command, flags };
}

const { command, flags } = parseArgs(process.argv.slice(2));
const slug = flags.book;
const allow = flags.allow ? String(flags.allow).split(',').map((s) => s.trim()).filter(Boolean) : [];

try {
  if (command === 'split') {
    const meta = runSplit({ slug, srcPath: flags.src, lang: flags.lang, title: flags.title, author: flags.author });
    if (flags.pd) {
      const { loadArtifact, saveArtifact } = await import('./paths.js');
      saveArtifact(slug, 'meta', { ...loadArtifact(slug, 'meta'), public_domain_basis: flags.pd });
    }
    console.log(`分章完成：${meta.total_chapters} 章`);
  } else if (command === 'glossary') {
    const glossary = await runGlossary({ slug, ai: createProducerAi(), force: Boolean(flags.force) });
    console.log(`术语表 ${glossary.entries.length} 条（work/${slug}/glossary.json 可人工修改译名后再翻译）`);
  } else if (command === 'translate') {
    const chapters = await runTranslate({ slug, ai: createProducerAi(), from: flags.from != null ? Number(flags.from) : null });
    console.log(`翻译完成：${chapters.length} 章`);
  } else if (command === 'extract') {
    const dossier = await runExtract({ slug, ai: createProducerAi() });
    console.log(`抽取完成：人物 ${dossier.characters.length} / 关系 ${dossier.relationships.length} / 事件 ${dossier.events.length}`);
  } else if (command === 'qa') {
    const result = runQa({ slug, allow });
    if (result.ok) console.log('QA 通过 ✅');
    else {
      console.error(`QA ${result.violations.length} 项未过：`);
      for (const v of result.violations) console.error(`  [${v.rule}] ${v.detail}`);
      process.exit(1);
    }
  } else if (command === 'pack') {
    const manifest = runPack({ slug, allow });
    console.log(`出包完成：packs/${manifest.slug}（${manifest.total_chapters} 章 / ${manifest.total_words} 字）`);
  } else {
    console.error('用法: cli.js <split|glossary|translate|extract|qa|pack> --book <slug> [flags]');
    process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
```

- [ ] **Step 5: 跑全部 producer 测试确认通过并提交**

Run: `cd tools/pack-producer && npx vitest run` → all pass

```bash
git add tools/pack-producer/src/pipeline/pack.js tools/pack-producer/src/pipeline/pack.test.js tools/pack-producer/src/cli.js
git commit -m "feat(producer): pack export with qa gate and manual cli"
```

---

# Part B · 子项目②：阅读端 DataSource 适配 + 静态构建

### Task 9: 防剧透纯函数模块（spoilerFilter）

**Files:**
- Create: `web/src/data/spoilerFilter.js`
- Test: `web/src/data/spoilerFilter.test.js`

**Interfaces:**
- Produces（供 PackDataSource 用，全部纯函数）：
  - `clampUpto(upto, totalChapters)` → 整数夹取到 `[0, total-1]`
  - `filterGraph(dossier, upto)` → `{ nodes, edges }`（node 含 `aliases` 数组；edge 字段 `{id, source, target, type, reveal_chapter, description}`；双端可见才保留）
  - `filterCharacter(dossier, charId, upto)` → 详情对象（`relationships` 带 `from`/`to` 人名，`events` 带 `involved` 人名数组）或 `null`
  - `filterTimeline(dossier, upto)` → 事件数组（`involved` 为人名）
  - `maskChapterTitles(chapters, upto)` → `[{ idx, title|null }]`
  - `searchChapters(chapters, q, upto)` → `{ results:[{chapterIdx,title,snippet,matchOffset}], truncated, upto }`（常量 SNIPPET_RADIUS=40 / PER_CHAPTER_LIMIT=5 / TOTAL_LIMIT=100，q 长度 2–50 否则抛 Error）
  - `computePercent(chapters, furthest)` → 0–100 整数（字数加权）

逻辑逐条对照 `server/src/routes/graph.js`、`server/src/routes/books.js`（chapters 列表与 computePercent）、`server/src/routes/search.js` 移植，**行为必须一致**。

- [ ] **Step 1: 写失败测试 `spoilerFilter.test.js`**

```js
import { describe, expect, it } from "vitest";
import {
  clampUpto, computePercent, filterCharacter, filterGraph,
  filterTimeline, maskChapterTitles, searchChapters
} from "./spoilerFilter.js";

const dossier = {
  characters: [
    { id: 1, name: "福尔摩斯", aliases: ["歇洛克"], identity: "侦探", first_seen_chapter: 0 },
    { id: 2, name: "华生", aliases: [], identity: "医生", first_seen_chapter: 1 },
    { id: 3, name: "凶手", aliases: [], identity: null, first_seen_chapter: 2 }
  ],
  relationships: [
    { id: 10, from_char_id: 1, to_char_id: 2, type: "朋友", reveal_chapter: 1, description: "同住" },
    { id: 11, from_char_id: 1, to_char_id: 3, type: "对手", reveal_chapter: 2, description: "追捕" }
  ],
  events: [
    { id: 20, description: "案发", occur_chapter: 0, reveal_chapter: 1, involved: [1, 2] },
    { id: 21, description: "真相", occur_chapter: 0, reveal_chapter: 2, involved: [1, 3] }
  ]
};
const chapters = [
  { idx: 0, title: "开端", content: "福尔摩斯在贝克街。", word_count: 9 },
  { idx: 1, title: "调查", content: "华生记录了案发经过。福尔摩斯沉思。", word_count: 17 },
  { idx: 2, title: "凶手现身", content: "凶手落网，真相大白。", word_count: 10 }
];

describe("spoilerFilter", () => {
  it("clampUpto 夹取范围", () => {
    expect(clampUpto(99, 3)).toBe(2);
    expect(clampUpto(-1, 3)).toBe(0);
    expect(clampUpto(1, 3)).toBe(1);
  });

  it("filterGraph：未出场人物与涉及它的边都不可见", () => {
    const graph = filterGraph(dossier, 1);
    expect(graph.nodes.map((n) => n.id)).toEqual([1, 2]);
    expect(graph.nodes[0].aliases).toEqual(["歇洛克"]);
    expect(graph.edges.map((e) => e.id)).toEqual([10]);
    expect(graph.edges[0]).toMatchObject({ source: 1, target: 2 });
  });

  it("filterCharacter：详情带人名，未揭露返回 null", () => {
    const detail = filterCharacter(dossier, 1, 1);
    expect(detail.relationships).toEqual([
      { id: 10, from_char_id: 1, from: "福尔摩斯", to_char_id: 2, to: "华生", type: "朋友", reveal_chapter: 1, description: "同住" }
    ]);
    expect(detail.events.length).toBe(1);
    expect(detail.events[0].involved).toEqual(["福尔摩斯", "华生"]);
    expect(filterCharacter(dossier, 3, 1)).toBeNull();
  });

  it("filterTimeline 按 reveal 过滤", () => {
    expect(filterTimeline(dossier, 1).map((e) => e.id)).toEqual([20]);
    expect(filterTimeline(dossier, 2).length).toBe(2);
  });

  it("maskChapterTitles 未读章标题为 null", () => {
    expect(maskChapterTitles(chapters, 1)).toEqual([
      { idx: 0, title: "开端" }, { idx: 1, title: "调查" }, { idx: 2, title: null }
    ]);
  });

  it("searchChapters 绝不泄露 upto 之后内容", () => {
    const result = searchChapters(chapters, "凶手", 1);
    expect(result.results).toEqual([]);
    const hit = searchChapters(chapters, "福尔摩斯", 1);
    expect(hit.results.length).toBe(2);
    expect(Math.max(...hit.results.map((r) => r.chapterIdx))).toBe(1);
    expect(hit.results[0].snippet).toContain("福尔摩斯");
    expect(() => searchChapters(chapters, "短", 1)).toThrow();
  });

  it("computePercent 字数加权", () => {
    // (9+17)/36 = 72.2 → 72
    expect(computePercent(chapters, 1)).toBe(72);
    expect(computePercent([], 0)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → `cd web && npx vitest run src/data/spoilerFilter.test.js` FAIL

- [ ] **Step 3: 实现 `spoilerFilter.js`**

```js
const SNIPPET_RADIUS = 40;
const PER_CHAPTER_LIMIT = 5;
const TOTAL_LIMIT = 100;

export function clampUpto(upto, totalChapters) {
  const parsed = Number(upto);
  if (!Number.isInteger(parsed)) return 0;
  return Math.max(0, Math.min(parsed, totalChapters - 1));
}

export function filterGraph(dossier, upto) {
  const nodes = dossier.characters
    .filter((c) => c.first_seen_chapter <= upto)
    .map((c) => ({ id: c.id, name: c.name, aliases: c.aliases || [], identity: c.identity, first_seen_chapter: c.first_seen_chapter }));
  const visible = new Set(nodes.map((n) => n.id));
  const edges = dossier.relationships
    .filter((r) => r.reveal_chapter <= upto && visible.has(r.from_char_id) && visible.has(r.to_char_id))
    .map((r) => ({ id: r.id, source: r.from_char_id, target: r.to_char_id, type: r.type, reveal_chapter: r.reveal_chapter, description: r.description }));
  return { nodes, edges };
}

export function filterCharacter(dossier, charId, upto) {
  const character = dossier.characters.find((c) => c.id === Number(charId) && c.first_seen_chapter <= upto);
  if (!character) return null;
  const visible = dossier.characters.filter((c) => c.first_seen_chapter <= upto);
  const nameById = new Map(visible.map((c) => [c.id, c.name]));

  const relationships = dossier.relationships
    .filter((r) => r.reveal_chapter <= upto && (r.from_char_id === character.id || r.to_char_id === character.id))
    .filter((r) => nameById.has(r.from_char_id) && nameById.has(r.to_char_id))
    .map((r) => ({
      id: r.id,
      from_char_id: r.from_char_id, from: nameById.get(r.from_char_id),
      to_char_id: r.to_char_id, to: nameById.get(r.to_char_id),
      type: r.type, reveal_chapter: r.reveal_chapter, description: r.description
    }));

  const events = dossier.events
    .filter((e) => e.reveal_chapter <= upto && e.involved.includes(character.id))
    .map((e) => ({
      id: e.id, description: e.description, occur_chapter: e.occur_chapter, reveal_chapter: e.reveal_chapter,
      involved: e.involved.filter((id) => nameById.has(id)).map((id) => nameById.get(id))
    }));

  return {
    id: character.id, name: character.name, aliases: character.aliases || [],
    identity: character.identity, first_seen_chapter: character.first_seen_chapter,
    relationships, events
  };
}

export function filterTimeline(dossier, upto) {
  const nameById = new Map(dossier.characters.filter((c) => c.first_seen_chapter <= upto).map((c) => [c.id, c.name]));
  return dossier.events
    .filter((e) => e.reveal_chapter <= upto)
    .sort((a, b) => a.occur_chapter - b.occur_chapter || a.reveal_chapter - b.reveal_chapter || a.id - b.id)
    .map((e) => ({
      id: e.id, description: e.description, occur_chapter: e.occur_chapter, reveal_chapter: e.reveal_chapter,
      involved: e.involved.filter((id) => nameById.has(id)).map((id) => nameById.get(id))
    }));
}

export function maskChapterTitles(chapters, upto) {
  return chapters.map((c) => ({ idx: c.idx, title: c.idx <= upto ? c.title : null }));
}

export function searchChapters(chapters, rawQ, upto) {
  const q = String(rawQ ?? "").trim();
  if (q.length < 2) throw new Error("搜索词至少 2 个字符。");
  if (q.length > 50) throw new Error("搜索词最长 50 个字符。");

  const results = [];
  let truncated = false;
  for (const chapter of chapters) {
    if (chapter.idx > upto) continue;
    let from = 0;
    let hits = 0;
    while (results.length < TOTAL_LIMIT) {
      const at = chapter.content.indexOf(q, from);
      if (at === -1) break;
      if (hits >= PER_CHAPTER_LIMIT) { truncated = true; break; }
      const start = Math.max(0, at - SNIPPET_RADIUS);
      const end = Math.min(chapter.content.length, at + q.length + SNIPPET_RADIUS);
      results.push({
        chapterIdx: chapter.idx,
        title: chapter.title,
        snippet: `${start > 0 ? "…" : ""}${chapter.content.slice(start, end)}${end < chapter.content.length ? "…" : ""}`,
        matchOffset: at
      });
      hits += 1;
      from = at + q.length;
    }
    if (results.length >= TOTAL_LIMIT) { truncated = true; break; }
  }
  return { results, truncated, upto };
}

export function computePercent(chapters, furthest) {
  let read = 0;
  let total = 0;
  for (const c of chapters) {
    total += c.word_count || 0;
    if (c.idx <= furthest) read += c.word_count || 0;
  }
  if (!total) return 0;
  return Math.round((read / total) * 100);
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd web && npx vitest run src/data/spoilerFilter.test.js` → 7 passed

```bash
git add web/src/data/spoilerFilter.js web/src/data/spoilerFilter.test.js
git commit -m "feat(web): client-side spoiler filter ported from server routes"
```

---

### Task 10: localStorage 进度/书签模块

**Files:**
- Create: `web/src/data/localProgress.js`
- Test: `web/src/data/localProgress.test.js`（vitest 无 jsdom 环境，测试里注入内存 storage）

**Interfaces:**
- Produces: `createLocalProgress(storage = globalThis.localStorage)` → `{ getProgress(slug), saveProgress(slug, current, totalChapters), listBookmarks(slug), addBookmark(slug, {chapter_idx, scroll_pct, note}), deleteBookmark(slug, id) }`。进度语义与 server 一致：`current` 夹取、`furthest = max(旧 furthest, current)`。书签对象 `{ id, chapter_idx, scroll_pct, note, created_at }`，id 为自增数字。

- [ ] **Step 1: 写失败测试 `localProgress.test.js`**

```js
import { describe, expect, it } from "vitest";
import { createLocalProgress } from "./localProgress.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

describe("localProgress", () => {
  it("进度双指针：回看不回退 furthest，current 夹取", () => {
    const store = createLocalProgress(memoryStorage());
    expect(store.getProgress("demo")).toEqual({ current_chapter: 0, furthest_chapter: 0 });
    store.saveProgress("demo", 5, 10);
    store.saveProgress("demo", 2, 10);
    expect(store.getProgress("demo")).toEqual({ current_chapter: 2, furthest_chapter: 5 });
    store.saveProgress("demo", 99, 10);
    expect(store.getProgress("demo").current_chapter).toBe(9);
  });

  it("书签增删查，跨书隔离", () => {
    const store = createLocalProgress(memoryStorage());
    const created = store.addBookmark("a", { chapter_idx: 1, scroll_pct: 0.5, note: "伏笔" });
    expect(created).toMatchObject({ id: 1, chapter_idx: 1, scroll_pct: 0.5, note: "伏笔" });
    expect(store.listBookmarks("a").length).toBe(1);
    expect(store.listBookmarks("b")).toEqual([]);
    store.deleteBookmark("a", created.id);
    expect(store.listBookmarks("a")).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现 `localProgress.js`**

```js
export function createLocalProgress(storage = globalThis.localStorage) {
  const read = (key, fallback) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => storage.setItem(key, JSON.stringify(value));

  const progressKey = (slug) => `mr-pack-progress-${slug}`;
  const bookmarksKey = (slug) => `mr-pack-bookmarks-${slug}`;

  return {
    getProgress(slug) {
      const saved = read(progressKey(slug), null);
      return { current_chapter: saved?.current_chapter ?? 0, furthest_chapter: saved?.furthest_chapter ?? 0 };
    },
    saveProgress(slug, requested, totalChapters) {
      const current = Math.max(0, Math.min(Number(requested) || 0, totalChapters - 1));
      const prev = this.getProgress(slug);
      const next = { current_chapter: current, furthest_chapter: Math.max(prev.furthest_chapter, current) };
      write(progressKey(slug), next);
      return next;
    },
    listBookmarks(slug) {
      return read(bookmarksKey(slug), []);
    },
    addBookmark(slug, { chapter_idx, scroll_pct = 0, note = null }) {
      const list = this.listBookmarks(slug);
      const id = list.reduce((max, b) => Math.max(max, b.id), 0) + 1;
      const bookmark = {
        id,
        chapter_idx: Number(chapter_idx),
        scroll_pct: Math.max(0, Math.min(1, Number(scroll_pct) || 0)),
        note: typeof note === "string" ? note.slice(0, 200) : null,
        created_at: new Date().toISOString()
      };
      write(bookmarksKey(slug), [...list, bookmark].sort((a, b) => a.chapter_idx - b.chapter_idx || a.id - b.id));
      return bookmark;
    },
    deleteBookmark(slug, id) {
      write(bookmarksKey(slug), this.listBookmarks(slug).filter((b) => b.id !== Number(id)));
      return { ok: true };
    }
  };
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd web && npx vitest run src/data/localProgress.test.js` → 2 passed

```bash
git add web/src/data/localProgress.js web/src/data/localProgress.test.js
git commit -m "feat(web): localStorage progress and bookmarks with dual-pointer semantics"
```

---

### Task 11: PackDataSource

**Files:**
- Create: `web/src/data/PackDataSource.js`
- Test: `web/src/data/PackDataSource.test.js`

**Interfaces:**
- Consumes: Task 9 全部函数、Task 10 `createLocalProgress`。
- Produces: `createPackDataSource({ fetchJson, progressStore } = {})` → 对象，**方法名与返回形状严格对齐 `web/src/api.js` 的 `api`**：
  `books() / book(id) / chapter(id, idx) / chapterList(id) / graph(id, upto) / character(id, charId, upto) / timeline(id, upto) / progress(id) / updateProgress(id, current) / search(id, q, upto) / bookmarks(id) / addBookmark(id, payload) / deleteBookmark(id, bookmarkId) / aiSettings() / health()`。
  差异点：`id` 是 slug 字符串；`book()` 返回 `{...manifest 字段, id: slug, import_status:'done', analyzed_chapters: total_chapters, current_chapter, furthest_chapter}`；`aiSettings()` 恒返回 `{ configured: false }`；`updateAiSettings/importBook/deleteBook/reExtractChapter/reExtractBook` 一律 `throw new Error('静态版不支持该操作。')`。
  另导出属性 `capabilities = { canImport: false, canManageBooks: false, canConfigureAi: false }`。
  默认 `fetchJson = (path) => fetch(`${import.meta.env.BASE_URL}packs/${path}`).then(r => { if (!r.ok) throw new Error('加载失败'); return r.json(); })`，包数据按 slug 记忆化缓存。

- [ ] **Step 1: 写失败测试 `PackDataSource.test.js`**

```js
import { describe, expect, it } from "vitest";
import { createPackDataSource } from "./PackDataSource.js";
import { createLocalProgress } from "./localProgress.js";

const files = {
  "index.json": [{ slug: "demo", title: "示例", author: "某某", total_chapters: 2, total_words: 26 }],
  "demo/manifest.json": { packVersion: 1, slug: "demo", title: "示例", author: "某某", lang: "en", total_chapters: 2, total_words: 26 },
  "demo/chapters.json": [
    { idx: 0, title: "开端", content: "福尔摩斯在贝克街等待。", word_count: 11 },
    { idx: 1, title: "凶手现身", content: "凶手终于现身并落网。", word_count: 10 }
  ],
  "demo/dossier.json": {
    characters: [
      { id: 1, name: "福尔摩斯", aliases: [], identity: "侦探", first_seen_chapter: 0 },
      { id: 2, name: "凶手", aliases: [], identity: null, first_seen_chapter: 1 }
    ],
    relationships: [{ id: 10, from_char_id: 1, to_char_id: 2, type: "对手", reveal_chapter: 1, description: "追捕" }],
    events: []
  }
};

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

function makeSource() {
  return createPackDataSource({
    fetchJson: async (path) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return structuredClone(files[path]);
    },
    progressStore: createLocalProgress(memoryStorage())
  });
}

describe("PackDataSource", () => {
  it("books/book 形状与 api 模式兼容", async () => {
    const src = makeSource();
    const books = await src.books();
    expect(books[0]).toMatchObject({ id: "demo", title: "示例", import_status: "done", total_chapters: 2 });
    const book = await src.book("demo");
    expect(book).toMatchObject({ id: "demo", current_chapter: 0, furthest_chapter: 0, analyzed_chapters: 2 });
  });

  it("防剧透链路：graph/chapterList/search 都尊重 upto", async () => {
    const src = makeSource();
    expect((await src.graph("demo", 0)).nodes.length).toBe(1);
    const list = await src.chapterList("demo"); // furthest=0
    expect(list[1].title).toBeNull();
    const found = await src.search("demo", "凶手", 0);
    expect(found.results).toEqual([]);
  });

  it("进度更新带 percent，furthest 不回退", async () => {
    const src = makeSource();
    const up = await src.updateProgress("demo", 1);
    expect(up).toMatchObject({ current_chapter: 1, furthest_chapter: 1 });
    expect(up.percent).toBe(100);
    const back = await src.updateProgress("demo", 0);
    expect(back).toMatchObject({ current_chapter: 0, furthest_chapter: 1, percent: 100 });
  });

  it("book/chapter 未命中抛错；写操作不可用", async () => {
    const src = makeSource();
    await expect(src.chapter("demo", 99)).rejects.toThrow("章节不存在");
    await expect(src.character("demo", 2, 0)).rejects.toThrow("尚未揭露");
    expect(() => src.importBook()).toThrow("静态版不支持");
    expect(src.capabilities.canImport).toBe(false);
    expect(await src.aiSettings()).toEqual({ configured: false });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现 `PackDataSource.js`**

```js
import {
  clampUpto, computePercent, filterCharacter, filterGraph,
  filterTimeline, maskChapterTitles, searchChapters
} from "./spoilerFilter.js";
import { createLocalProgress } from "./localProgress.js";

export function createPackDataSource({ fetchJson, progressStore } = {}) {
  const load = fetchJson || (async (path) => {
    const response = await fetch(`${import.meta.env.BASE_URL}packs/${path}`);
    if (!response.ok) throw new Error("卷宗包加载失败。");
    return response.json();
  });
  const progress = progressStore || createLocalProgress();
  const cache = new Map();

  async function pack(slug) {
    if (!cache.has(slug)) {
      cache.set(slug, Promise.all([
        load(`${slug}/manifest.json`),
        load(`${slug}/chapters.json`),
        load(`${slug}/dossier.json`)
      ]).then(([manifest, chapters, dossier]) => ({ manifest, chapters, dossier })));
    }
    return cache.get(slug);
  }

  function unsupported() {
    throw new Error("静态版不支持该操作。");
  }

  return {
    capabilities: { canImport: false, canManageBooks: false, canConfigureAi: false },
    health: async () => ({ ok: true }),
    aiSettings: async () => ({ configured: false }),
    updateAiSettings: unsupported,
    importBook: unsupported,
    deleteBook: unsupported,
    reExtractChapter: unsupported,
    reExtractBook: unsupported,

    async books() {
      const index = await load("index.json");
      return index.map((item) => ({
        id: item.slug, title: item.title, author: item.author,
        total_chapters: item.total_chapters, import_status: "done", analyzed_chapters: item.total_chapters,
        source_format: "pack"
      }));
    },

    async book(id) {
      const { manifest } = await pack(id);
      const saved = progress.getProgress(id);
      return {
        ...manifest, id,
        import_status: "done", analyzed_chapters: manifest.total_chapters,
        current_chapter: saved.current_chapter, furthest_chapter: saved.furthest_chapter
      };
    },

    async chapter(id, idx) {
      const { chapters } = await pack(id);
      const chapter = chapters.find((c) => c.idx === Number(idx));
      if (!chapter) throw new Error("章节不存在。");
      return { idx: chapter.idx, title: chapter.title, content: chapter.content };
    },

    async chapterList(id) {
      const { chapters } = await pack(id);
      const saved = progress.getProgress(id);
      return maskChapterTitles(chapters, saved.furthest_chapter);
    },

    async graph(id, upto) {
      const { manifest, dossier } = await pack(id);
      return filterGraph(dossier, clampUpto(upto, manifest.total_chapters));
    },

    async character(id, charId, upto) {
      const { manifest, dossier } = await pack(id);
      const detail = filterCharacter(dossier, charId, clampUpto(upto, manifest.total_chapters));
      if (!detail) throw new Error("人物不存在或尚未揭露。");
      return detail;
    },

    async timeline(id, upto) {
      const { manifest, dossier } = await pack(id);
      return filterTimeline(dossier, clampUpto(upto, manifest.total_chapters));
    },

    async progress(id) {
      const { chapters } = await pack(id);
      const saved = progress.getProgress(id);
      return { ...saved, percent: computePercent(chapters, saved.furthest_chapter) };
    },

    async updateProgress(id, current) {
      const { manifest, chapters } = await pack(id);
      const saved = progress.saveProgress(id, current, manifest.total_chapters);
      return { ...saved, percent: computePercent(chapters, saved.furthest_chapter) };
    },

    async search(id, q, upto) {
      const { manifest, chapters } = await pack(id);
      return searchChapters(chapters, q, clampUpto(upto, manifest.total_chapters));
    },

    bookmarks: async (id) => progress.listBookmarks(id),
    addBookmark: async (id, payload) => progress.addBookmark(id, payload),
    deleteBookmark: async (id, bookmarkId) => progress.deleteBookmark(id, bookmarkId)
  };
}
```

- [ ] **Step 4: 跑测试确认通过并提交**

Run: `cd web && npx vitest run src/data/PackDataSource.test.js` → 4 passed

```bash
git add web/src/data/PackDataSource.js web/src/data/PackDataSource.test.js
git commit -m "feat(web): static pack data source with client-side spoiler filtering"
```

---

### Task 12: 数据源工厂 + 全组件 import 切换

**Files:**
- Create: `web/src/data/ApiDataSource.js`、`web/src/data/index.js`
- Modify: `web/src/App.jsx:2`、`web/src/pages/Reader.jsx`、`web/src/pages/Library.jsx:2`、`web/src/components/DossierCard.jsx:2`、`web/src/components/TocDrawer.jsx:2`、`web/src/components/SearchPanel.jsx:2`

**Interfaces:**
- Produces: `web/src/data/index.js` 导出 `export const api`（`import.meta.env.VITE_DATA_MODE === 'pack'` 时为 PackDataSource，否则 ApiDataSource）。组件继续用 `api.xxx` 同名方法，**组件内部零改动**（只换 import 行）。

- [ ] **Step 1: 新建 `ApiDataSource.js`**

```js
import { api as httpApi } from "../api.js";

export function createApiDataSource() {
  return {
    ...httpApi,
    capabilities: { canImport: true, canManageBooks: true, canConfigureAi: true }
  };
}
```

- [ ] **Step 2: 新建 `data/index.js`**

```js
import { createApiDataSource } from "./ApiDataSource.js";
import { createPackDataSource } from "./PackDataSource.js";

export const api = import.meta.env.VITE_DATA_MODE === "pack"
  ? createPackDataSource()
  : createApiDataSource();
```

- [ ] **Step 3: 替换各文件 import 行（精确替换，其余不动）**

| 文件 | 原行 | 新行 |
|---|---|---|
| `web/src/App.jsx` | `import { api } from "./api.js";` | `import { api } from "./data/index.js";` |
| `web/src/pages/Reader.jsx` | `import { api } from "../api.js";` | `import { api } from "../data/index.js";` |
| `web/src/pages/Library.jsx` | `import { api, openImportProgress } from "../api.js";` | `import { api } from "../data/index.js";`<br>`import { openImportProgress } from "../api.js";` |
| `web/src/components/DossierCard.jsx` | `import { api } from "../api.js";` | `import { api } from "../data/index.js";` |
| `web/src/components/TocDrawer.jsx` | `import { api } from "../api.js";` | `import { api } from "../data/index.js";` |
| `web/src/components/SearchPanel.jsx` | `import { api } from "../api.js";` | `import { api } from "../data/index.js";` |

执行前先 `grep -rn 'from "../api.js"\|from "./api.js"' web/src` 核对清单完整（若组件有遗漏一并替换并在提交信息注明）。

- [ ] **Step 4: 构建两种模式验证 + api 模式回归**

Run: `npm run build -w web && VITE_DATA_MODE=pack npm run build -w web`
Expected: 两次构建都成功
Run: `cd server && npx vitest run` → 36 passed（Global Constraint：server 未动）

- [ ] **Step 5: 提交**

```bash
git add web/src/data/ApiDataSource.js web/src/data/index.js web/src/App.jsx web/src/pages web/src/components
git commit -m "feat(web): data source factory switching api/pack modes"
```

---

### Task 13: capabilities UI 门控

**Files:**
- Modify: `web/src/pages/Library.jsx`、`web/src/pages/Reader.jsx`

静态包模式下隐藏所有"写/配置"入口。**用 `api.capabilities` 判断，不新增 props**。

- [ ] **Step 1: Library.jsx 五处门控（对照行号为 Task 12 完成后的文件）**

(a) `loadAiSettings` 开头加守卫：

```js
  const loadAiSettings = useCallback(async () => {
    if (!api.capabilities.canConfigureAi) return;
    try {
```

(b) header 的两个按钮（`设置` 与 `导入书籍`，位于 `<div className="flex items-center gap-2">` 内）分别包裹：

```jsx
          {api.capabilities.canConfigureAi && (
            <button ...原设置按钮不动.../>
          )}
          {api.capabilities.canImport && (
            <button ...原导入书籍按钮不动.../>
          )}
```

(c) 空书架的导入 CTA（`cf-empty-wrapper` 内的 button）：pack 模式书架必有书（index.json），保持原样即可，不改。

(d) `删除当前` 按钮条件从 `{selectedBook && (` 改为 `{selectedBook && api.capabilities.canManageBooks && (`。

(e) 底部 `{activeImport && (...)}` 与 `<AiSettingsDialog ...>`：分别改为 `{api.capabilities.canImport && activeImport && (...)}` 与 `{api.capabilities.canConfigureAi && <AiSettingsDialog ... />}`（AiSettingsDialog 整段用条件包裹）。

- [ ] **Step 2: Reader.jsx 两处门控**

(a) `loadAiSettings`（Reader 内同名函数）开头加同样守卫 `if (!api.capabilities.canConfigureAi) return;`
(b) 渲染尾部 `<AiSettingsDialog ...>` 包裹 `{api.capabilities.canConfigureAi && ( ... )}`。
（`graphEmptyContent` 的 pending_config/error 分支不用改：pack 模式 `import_status` 恒为 `done`，走不到。）

- [ ] **Step 3: 构建验证 + 提交**

Run: `npm run build -w web && VITE_DATA_MODE=pack npm run build -w web` → 均成功

```bash
git add web/src/pages/Library.jsx web/src/pages/Reader.jsx
git commit -m "feat(web): gate import/settings/manage ui behind data source capabilities"
```

---

### Task 14: 静态构建目标 + GitHub Pages 部署

**Files:**
- Modify: `web/package.json`（scripts）、`package.json`（根 scripts）
- Create: `.github/workflows/deploy-pages.yml`

- [ ] **Step 1: web/package.json scripts 加**

```json
    "build:static": "VITE_DATA_MODE=pack vite build --base=/mystery-reader/ --outDir dist-static"
```

根 package.json scripts 加：

```json
    "build:static": "npm run build:static -w web && rm -rf web/dist-static/packs && cp -R packs web/dist-static/packs"
```

- [ ] **Step 2: 本地验证（需 packs/ 至少有一本样书；子项目③之前可用测试 fixture 手工放一套 Task 11 测试里的 demo 数据）**

Run: `npm run build:static && ls web/dist-static/packs/index.json`
Expected: 构建成功、index.json 存在
Run: `cd web && npx vite preview --outDir dist-static --base /mystery-reader/` 浏览器打开验证书架能列出书。

- [ ] **Step 3: 新建 `.github/workflows/deploy-pages.yml`**

```yaml
name: Deploy static reader to GitHub Pages

on:
  push:
    branches: [main]
    paths: ['web/**', 'packs/**', '.github/workflows/deploy-pages.yml']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build:static
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web/dist-static
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: 提交并启用 Pages**

```bash
git add web/package.json package.json .github/workflows/deploy-pages.yml
git commit -m "feat(deploy): static build target and github pages workflow"
```

推送后需在 GitHub 仓库 Settings → Pages → Source 选择 **GitHub Actions**（一次性手动操作，执行者在报告中提醒用户完成）。部署地址：`https://johnxiong123.github.io/mystery-reader/`。

---

# Part C · 子项目③：内容生产 Runbook（CLI 就绪后执行）

> 这不是代码任务，是逐书操作手册。每本书一个 PR 或一次 main 提交（`content(packs): add <slug>`）。**翻译/抽取步骤消耗真实 API 费用**，跑之前和用户确认模型与预算（建议用 .env 里现有 DeepSeek 配置，单本长篇约几十万 token 量级）。

### Task 15: 首本书《冒险史》（打通全链路）

- [ ] **Step 1: 取原文**（Project Gutenberg #1661，公版依据：柯南·道尔 1930 年卒）

```bash
curl -L -o /tmp/adventures-holmes.txt https://www.gutenberg.org/cache/epub/1661/pg1661.txt
# 手工删掉文件头尾的 Gutenberg 许可样板文字（"*** START OF ..." 之前与 "*** END OF ..." 之后），只留正文
```

- [ ] **Step 2: 跑管线**

```bash
node tools/pack-producer/src/cli.js split --book holmes-adventures --src /tmp/adventures-holmes.txt \
  --lang en --title "冒险史（福尔摩斯短篇集）" --author "阿瑟·柯南·道尔" --pd "作者 1930 年卒，原著公版"
node tools/pack-producer/src/cli.js glossary --book holmes-adventures
# ⬆️ 停下：打开 tools/pack-producer/work/holmes-adventures/glossary.json 人工核对译名（福尔摩斯/华生等通行译名），改完再继续
node tools/pack-producer/src/cli.js translate --book holmes-adventures
node tools/pack-producer/src/cli.js extract --book holmes-adventures
node tools/pack-producer/src/cli.js qa --book holmes-adventures
node tools/pack-producer/src/cli.js pack --book holmes-adventures
```

- [ ] **Step 3: 人工抽检**（验收口径：每本随机 3 章人工过目）

随机选 3 章，检查：译文通顺无漏段、人名前后一致、对话格式正常。不合格 → 改 glossary 或 `translate --from N` 重译该章起。

- [ ] **Step 4: 本地静态版联调 + 提交**

```bash
npm run build:static && cd web && npx vite preview --outDir dist-static --base /mystery-reader/
# 手动验收：书架见《冒险史》→ 打开 → 目录/搜索/书签/选中即查/关系图全链路可用；无痕窗口 30 秒内读到正文
git add packs/ && git commit -m "content(packs): add holmes-adventures"
```

### Task 16: 第二三本（乱步短篇选 ja、亚森·罗宾 en）

- [ ] 乱步：青空文库（aozora.gr.jp）下载『二銭銅貨』『Ｄ坂の殺人事件』『心理試験』『人間椅子』『屋根裏の散歩者』合并为一个 txt（每篇作一章，篇名行作章节标题行），`--lang ja --pd "作者 1965 年卒，原著公版"`，slug `ranpo-short-stories`。注意：日文源 QA 检测假名残留。
- [ ] 罗宾：Gutenberg #6133《The Extraordinary Adventures of Arsène Lupin》（英译本，美国公版），`--lang en --pd "作者 1941 年卒；采用美国公版英译本转译"`，slug `arsene-lupin`。⚠️ 该本走"译本转译"，法律上最弱的一环，README 书目页需标注来源。
- [ ] 各自走 Task 15 的 Step 2–4 流程。
- [ ] 全部上线后更新 `README.md`：新增「在线版」入口（部署 URL）+ 内置书目表（书名/作者/公版依据/来源）。

### 最终验收（对照 spec §5）

- [ ] 无痕浏览器打开 `https://johnxiong123.github.io/mystery-reader/` → 30 秒内读到正文 + 关系图，零配置
- [ ] 任一本书：读到第 N 章回看旧章，进度/搜索/目录防剧透行为与本地版一致
- [ ] `cd server && npx vitest run` 36 passed（本地模式零回归）
- [ ] 三本书译名一致性 QA 全绿、人工抽检通过

---

## Self-Review 记录

- **Spec 覆盖**：§3.1 格式→Task 8（manifest/chapters/dossier/glossary/index）；§3.2 五步管线→Task 2/4/5/6/7 + CLI Task 8；§3.3 DataSource/防剧透前移/localStorage/裁剪/双构建→Task 9–13；部署→Task 14；§4 书目→Task 15/16（含阿加莎排除、公版依据字段）；§5 验收→Task 7（译名 0 容忍阻断）、Task 9（防剧透单测）、Task 12 Step 4 + 最终验收（server 回归、零门槛）。无缺口。
- **类型一致性**：`dossier.events[].involved` 全链路为 **id 数组**（producer store → pack JSON → spoilerFilter 输入），filterCharacter/filterTimeline 输出转人名数组与 server API 形状一致；`knownCharacters()` 的 aliases 序列化为 JSON 字符串以匹配 `buildExtractionMessages` 既有行为；`api` 导出名在两种 DataSource 下方法签名一致（Task 11 Interfaces 已列全）。`chunkParagraphs` 测试断言已按实现语义核对修正为 4 块（a | b | c 前 100 | c 后 20）。
- **占位符扫描**：Task 2 的正则回退是显式授权的兜底路径（有精确正则），非 TBD；Task 15/16 为 runbook 性质，命令完整。无 TBD/TODO。
- **已知边界**：`server/src/config.js` 被 producer import 时会读根 .env——CLI 场景正确；测试注入 mock client 不触发。`structuredClone` Node ≥17 可用，符合 Node ≥20 约束。
