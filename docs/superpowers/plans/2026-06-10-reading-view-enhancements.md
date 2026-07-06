# 阅读视图增强（簇①）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给阅读页加上：furthest/current 进度双指针、章节目录（TOC）、防剧透全文搜索、字数加权进度%、书签、选中即查人物档案卡。

**Architecture:** 后端 Fastify + better-sqlite3，所有数据按 `upto` 服务端防剧透过滤；前端 React（Vite）。先做 DB 迁移与后端接口（TDD，vitest + app.inject），再做前端接线。`current_chapter` = 防剧透边界（可回退）；`furthest_chapter` = 进度/搜索/续读基准（只进不退）。阅读阶段零 AI 调用。

**Tech Stack:** Fastify 4、better-sqlite3、vitest、React 18、Tailwind。

**Spec:** `docs/superpowers/specs/2026-06-10-reading-view-enhancements-design.md`

**约定（每个任务都适用）：**
- 服务端测试模式参考 `server/src/routes/books.test.js`：`initDb` 到临时目录 + `Fastify({logger:false})` + `installErrorHandler` + `app.inject`。
- 跑单个测试文件：`cd server && npx vitest run src/routes/<file>.test.js`；全量：`npm test`（根目录）。
- 提交信息格式 `type(scope): description`（英文）。

---

## File Structure

```
server/src/db.js                    # 迁移：furthest_chapter / word_count / bookmarks 表
server/src/db.test.js               # 新增：迁移测试
server/src/routes/books.js          # progress 双指针、/chapters 列表、import 写 word_count
server/src/routes/books.test.js     # 增补测试
server/src/routes/search.js         # 新增：/search
server/src/routes/search.test.js    # 新增
server/src/routes/bookmarks.js      # 新增：bookmarks CRUD
server/src/routes/bookmarks.test.js # 新增
server/src/routes/graph.js          # nodes 补 aliases
server/src/routes/graph.test.js     # 新增
server/src/index.js                 # 注册新路由
web/package.json                    # 加 vitest
web/src/api.js                      # 新接口方法
web/src/selectionLookup.js          # 新增：选区匹配纯函数
web/src/selectionLookup.test.js     # 新增
web/src/components/ReaderPane.jsx   # 选区监听、footer 进度%
web/src/components/SelectionDossier.jsx  # 新增：浮层档案卡 + 未命中提示
web/src/components/TocDrawer.jsx    # 新增：章节目录抽屉
web/src/components/SearchPanel.jsx  # 新增：搜索面板
web/src/components/BookmarkPanel.jsx # 新增：书签面板
web/src/pages/Reader.jsx            # 全部接线
```

---

### Task 1: DB 迁移（furthest_chapter / word_count / bookmarks）

**Files:**
- Modify: `server/src/db.js`
- Test: `server/src/db.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/src/db.test.js`：

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from './db.js';

describe('db migrations', () => {
  let tempDir;
  let db;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-db-'));
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function config() {
    return {
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    };
  }

  it('全新数据库包含 furthest_chapter、word_count 与 bookmarks 表', () => {
    db = initDb(config());
    const progressCols = db.prepare("PRAGMA table_info(reading_progress)").all().map((c) => c.name);
    expect(progressCols).toContain('furthest_chapter');
    const chapterCols = db.prepare("PRAGMA table_info(chapters)").all().map((c) => c.name);
    expect(chapterCols).toContain('word_count');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    expect(tables).toContain('bookmarks');
  });

  it('旧库升级：补列并回填 furthest_chapter 与 word_count', () => {
    // 手工构造旧版 schema
    const raw = new Database(config().dbPath);
    raw.exec(`
      CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT,
        source_format TEXT, total_chapters INTEGER NOT NULL, import_status TEXT NOT NULL,
        analyzed_chapters INTEGER DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE chapters (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL,
        idx INTEGER NOT NULL, title TEXT, content TEXT NOT NULL,
        extract_status TEXT DEFAULT 'pending', UNIQUE(book_id, idx));
      CREATE TABLE reading_progress (book_id INTEGER PRIMARY KEY,
        current_chapter INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    `);
    raw.prepare(`INSERT INTO books (title, total_chapters, import_status, created_at)
      VALUES ('旧书', 2, 'done', ?)`).run(nowIso());
    raw.prepare(`INSERT INTO chapters (book_id, idx, title, content) VALUES (1, 0, '第一章', '十二个字的正文内容在此处')`).run();
    raw.prepare(`INSERT INTO reading_progress (book_id, current_chapter, updated_at) VALUES (1, 5, ?)`).run(nowIso());
    raw.close();

    db = initDb(config());

    const progress = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = 1').get();
    expect(progress.furthest_chapter).toBe(5); // 回填 = current
    const chapter = db.prepare('SELECT word_count, LENGTH(content) AS len FROM chapters WHERE book_id = 1').get();
    expect(chapter.word_count).toBe(chapter.len);
  });

  it('迁移幂等：initDb 可重复执行', () => {
    db = initDb(config());
    db.close();
    db = initDb(config());
    expect(db.prepare("PRAGMA table_info(reading_progress)").all().map((c) => c.name)).toContain('furthest_chapter');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/db.test.js`
Expected: FAIL（`furthest_chapter` 不存在等）

- [ ] **Step 3: 实现迁移**

修改 `server/src/db.js`：CREATE TABLE 块中 `reading_progress` 加列、新增 `bookmarks` 表；`chapters` 加 `word_count INTEGER`；CREATE 块后加守卫式 ALTER + 回填。

`reading_progress` 的 CREATE 改为：

```sql
    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id INTEGER PRIMARY KEY,
      current_chapter INTEGER NOT NULL DEFAULT 0,
      furthest_chapter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_idx INTEGER NOT NULL,
      scroll_pct REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );
```

`chapters` 的 CREATE 中 `extract_status TEXT DEFAULT 'pending',` 之后加一行 `word_count INTEGER,`（注意放在 `UNIQUE(book_id, idx)` 之前）。

在 `db.exec(...)` 之后、`repairImportStatuses(db)` 之前插入：

```js
  runMigrations(db);
```

文件底部新增：

```js
function runMigrations(database) {
  ensureColumn(database, 'reading_progress', 'furthest_chapter', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'chapters', 'word_count', 'INTEGER');
  database.exec(`
    UPDATE reading_progress SET furthest_chapter = current_chapter WHERE furthest_chapter < current_chapter;
    UPDATE chapters SET word_count = LENGTH(content) WHERE word_count IS NULL;
  `);
}

function ensureColumn(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/db.test.js`
Expected: 3 passed

- [ ] **Step 5: 跑全量测试确认无回归，提交**

Run: `cd server && npx vitest run`
Expected: all pass

```bash
git add server/src/db.js server/src/db.test.js
git commit -m "feat(db): add furthest_chapter, word_count and bookmarks with guarded migrations"
```

---

### Task 2: 导入流程写入 word_count

**Files:**
- Modify: `server/src/routes/books.js:44-50`
- Test: `server/src/routes/books.test.js`

- [ ] **Step 1: 写失败测试**

在 `books.test.js` 的 `describe('book import without API key')` 内追加：

```js
  it('导入时为每章写入 word_count', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/books/import',
      headers: multipartHeaders('boundary'),
      payload: multipartBody('boundary', 'sample.txt', [
        '第一章 雨夜', '', '林砚推开旧书店的门。', '', '第二章 名单', '', '名单上有三个陌生名字。'
      ].join('\n'))
    });
    const payload = JSON.parse(response.body);
    const rows = db.prepare('SELECT word_count, LENGTH(content) AS len FROM chapters WHERE book_id = ?').all(payload.bookId);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.word_count).toBe(row.len);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/routes/books.test.js`
Expected: FAIL（word_count 为 null）

- [ ] **Step 3: 实现**

`books.js` 中 `insertChapter` 改为：

```js
      const insertChapter = db.prepare(`
        INSERT INTO chapters (book_id, idx, title, content, extract_status, word_count)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `);
      parsed.chapters.forEach((chapter, idx) => {
        insertChapter.run(bookId, idx, chapter.title || `第 ${idx + 1} 章`, chapter.content, chapter.content.length);
      });
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd server && npx vitest run src/routes/books.test.js` → PASS

```bash
git add server/src/routes/books.js server/src/routes/books.test.js
git commit -m "feat(import): persist per-chapter word_count"
```

---

### Task 3: progress 双指针 + 字数加权 percent

**Files:**
- Modify: `server/src/routes/books.js:140-159`（GET/PUT /progress）、`server/src/routes/books.js:80-81`（GET /books/:id）
- Test: `server/src/routes/books.test.js`

- [ ] **Step 1: 写失败测试**

在 `books.test.js` 新增 describe（复用文件内已有的 `seedFullBook`；需要多章节时直接插入）：

```js
describe('reading progress dual pointer', () => {
  let tempDir;
  let db;
  let app;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-progress-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await app.register(multipart, { limits: { fileSize: 1024 * 1024, files: 1 } });
    await registerBookRoutes(app, {
      db,
      config: { uploadDir: path.join(tempDir, 'uploads'), ai: {} },
      extractor: { extractBook: vi.fn(), extractChapter: vi.fn() },
      settingsStore: { getAiSettings: () => ({ configured: false }) }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function seedThreeChapterBook() {
    const bookId = Number(db.prepare(`
      INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
      VALUES ('进度书', null, 'txt', 3, 'done', 3, ?)
    `).run(nowIso()).lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO chapters (book_id, idx, title, content, extract_status, word_count)
      VALUES (?, ?, ?, ?, 'done', ?)
    `);
    insert.run(bookId, 0, '一', 'a'.repeat(100), 100);
    insert.run(bookId, 1, '二', 'b'.repeat(300), 300);
    insert.run(bookId, 2, '三', 'c'.repeat(600), 600);
    db.prepare(`INSERT INTO reading_progress (book_id, current_chapter, furthest_chapter, updated_at)
      VALUES (?, 0, 0, ?)`).run(bookId, nowIso());
    return bookId;
  }

  it('前进时 furthest 跟进，回看时 furthest 不回退', async () => {
    const bookId = seedThreeChapterBook();
    await app.inject({ method: 'PUT', url: `/api/books/${bookId}/progress`, payload: { current_chapter: 2 } });
    const back = await app.inject({ method: 'PUT', url: `/api/books/${bookId}/progress`, payload: { current_chapter: 0 } });
    expect(JSON.parse(back.body)).toMatchObject({ current_chapter: 0, furthest_chapter: 2 });

    const got = await app.inject({ method: 'GET', url: `/api/books/${bookId}/progress` });
    expect(JSON.parse(got.body)).toMatchObject({ current_chapter: 0, furthest_chapter: 2 });
  });

  it('GET progress 返回按字数加权的 percent（基于 furthest）', async () => {
    const bookId = seedThreeChapterBook();
    await app.inject({ method: 'PUT', url: `/api/books/${bookId}/progress`, payload: { current_chapter: 1 } });
    const got = JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/progress` })).body);
    // furthest=1 → (100+300)/1000 = 40%
    expect(got.percent).toBe(40);
  });

  it('GET /books/:id 同时返回 furthest_chapter', async () => {
    const bookId = seedThreeChapterBook();
    await app.inject({ method: 'PUT', url: `/api/books/${bookId}/progress`, payload: { current_chapter: 2 } });
    await app.inject({ method: 'PUT', url: `/api/books/${bookId}/progress`, payload: { current_chapter: 1 } });
    const book = JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}` })).body);
    expect(book.current_chapter).toBe(1);
    expect(book.furthest_chapter).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/routes/books.test.js`
Expected: 新增 3 条 FAIL

- [ ] **Step 3: 实现**

`books.js` 中三处修改。

GET `/api/books/:id`（替换 80-81 行）：

```js
    const progress = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = ?').get(id);
    return {
      ...book,
      current_chapter: progress?.current_chapter ?? 0,
      furthest_chapter: progress?.furthest_chapter ?? 0
    };
```

GET `/progress` 整个 handler 替换为：

```js
  app.get('/api/books/:id/progress', async (request) => {
    const id = numberParam(request.params.id, 'id');
    ensureBook(db, id);
    const row = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = ?').get(id);
    const current = row?.current_chapter ?? 0;
    const furthest = row?.furthest_chapter ?? 0;
    return { current_chapter: current, furthest_chapter: furthest, percent: computePercent(db, id, furthest) };
  });
```

PUT `/progress` 整个 handler 替换为：

```js
  app.put('/api/books/:id/progress', async (request) => {
    const id = numberParam(request.params.id, 'id');
    const book = ensureBook(db, id);
    const requested = Number(request.body?.current_chapter);
    if (!Number.isInteger(requested)) throw badRequest('current_chapter 必须是整数。');
    const current = Math.max(0, Math.min(requested, book.total_chapters - 1));
    db.prepare(`
      INSERT INTO reading_progress (book_id, current_chapter, furthest_chapter, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        current_chapter = excluded.current_chapter,
        furthest_chapter = MAX(reading_progress.furthest_chapter, excluded.furthest_chapter),
        updated_at = excluded.updated_at
    `).run(id, current, current, nowIso());
    const row = db.prepare('SELECT current_chapter, furthest_chapter FROM reading_progress WHERE book_id = ?').get(id);
    return { ...row, percent: computePercent(db, id, row.furthest_chapter) };
  });
```

文件底部（`numberParam` 旁）新增：

```js
function computePercent(db, bookId, furthest) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN idx <= ? THEN word_count END), 0) AS read_words,
      COALESCE(SUM(word_count), 0) AS total_words
    FROM chapters WHERE book_id = ?
  `).get(furthest, bookId);
  if (!row.total_words) return 0;
  return Math.round((row.read_words / row.total_words) * 100);
}
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd server && npx vitest run src/routes/books.test.js` → PASS

```bash
git add server/src/routes/books.js server/src/routes/books.test.js
git commit -m "feat(progress): dual-pointer current/furthest with word-weighted percent"
```

---

### Task 4: TOC 章节列表接口（未读章标题置空）

**Files:**
- Modify: `server/src/routes/books.js`（`GET /api/books/:id/chapters/:idx` 之前插入新端点）
- Test: `server/src/routes/books.test.js`

- [ ] **Step 1: 写失败测试**

在 Task 3 的 `describe('reading progress dual pointer')` 同文件新增 describe（同样的 beforeEach/afterEach 结构，复用 `seedThreeChapterBook` —— 将其提升为文件级函数，参数 `db`）：

```js
describe('chapter list (TOC)', () => {
  // beforeEach/afterEach 与 reading progress dual pointer 相同
  it('未读章节 title 为 null，已读章节带标题', async () => {
    const bookId = seedThreeChapterBook(db);
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/chapters?upto=1` });
    const list = JSON.parse(res.body);
    expect(list).toEqual([
      { idx: 0, title: '一' },
      { idx: 1, title: '二' },
      { idx: 2, title: null }
    ]);
  });

  it('不带 upto 时按 furthest_chapter 过滤', async () => {
    const bookId = seedThreeChapterBook(db);
    await app.inject({ method: 'PUT', url: `/api/books/${bookId}/progress`, payload: { current_chapter: 2 } });
    await app.inject({ method: 'PUT', url: `/api/books/${bookId}/progress`, payload: { current_chapter: 0 } });
    const list = JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/chapters` })).body);
    expect(list[2].title).toBe('三'); // furthest=2，全部已读
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/routes/books.test.js`
Expected: FAIL（404 接口不存在）

- [ ] **Step 3: 实现**

`books.js` 中 `GET /api/books/:id/chapters/:idx` **之前**插入（Fastify 静态段优先，但保险起见放前面）：

```js
  app.get('/api/books/:id/chapters', async (request) => {
    const id = numberParam(request.params.id, 'id');
    const book = ensureBook(db, id);
    let upto;
    if (request.query.upto != null) {
      const parsed = Number(request.query.upto);
      if (!Number.isInteger(parsed) || parsed < 0) throw badRequest('upto 必须是非负整数。');
      upto = Math.min(parsed, book.total_chapters - 1);
    } else {
      const progress = db.prepare('SELECT furthest_chapter FROM reading_progress WHERE book_id = ?').get(id);
      upto = progress?.furthest_chapter ?? 0;
    }
    return db.prepare(`
      SELECT idx, CASE WHEN idx <= ? THEN title ELSE NULL END AS title
      FROM chapters WHERE book_id = ? ORDER BY idx ASC
    `).all(upto, id);
  });
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd server && npx vitest run src/routes/books.test.js` → PASS

```bash
git add server/src/routes/books.js server/src/routes/books.test.js
git commit -m "feat(toc): chapter list endpoint hiding unread titles server-side"
```

---

### Task 5: /search 防剧透全文搜索

**Files:**
- Create: `server/src/routes/search.js`
- Modify: `server/src/index.js`（注册）
- Test: `server/src/routes/search.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/src/routes/search.test.js`：

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { installErrorHandler } from '../errors.js';
import { registerSearchRoutes } from './search.js';

describe('book search', () => {
  let tempDir;
  let db;
  let app;
  let bookId;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-search-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await registerSearchRoutes(app, { db });
    await app.ready();

    bookId = Number(db.prepare(`
      INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
      VALUES ('搜索书', null, 'txt', 3, 'done', 3, ?)
    `).run(nowIso()).lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO chapters (book_id, idx, title, content, extract_status, word_count)
      VALUES (?, ?, ?, ?, 'done', LENGTH(?))
    `);
    insert.run(bookId, 0, '一', '林砚在雨夜推开了旧书店的门，匿名信就放在柜台上。', '林砚在雨夜推开了旧书店的门，匿名信就放在柜台上。');
    insert.run(bookId, 1, '二', '名单上的第三个名字让林砚停住了呼吸。', '名单上的第三个名字让林砚停住了呼吸。');
    insert.run(bookId, 2, '三', '凶手终于现身，匿名信的笔迹与他完全吻合。', '凶手终于现身，匿名信的笔迹与他完全吻合。');
    db.prepare(`INSERT INTO reading_progress (book_id, current_chapter, furthest_chapter, updated_at)
      VALUES (?, 1, 1, ?)`).run(bookId, nowIso());
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('只命中 upto 范围内的章节，绝不泄露后文', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=匿名信&upto=1` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(1);
    expect(body.results[0].chapterIdx).toBe(0);
    expect(body.results.some((r) => r.chapterIdx === 2)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('凶手');
  });

  it('snippet 含关键词且带 matchOffset', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=林砚&upto=1` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(2);
    for (const r of body.results) {
      expect(r.snippet).toContain('林砚');
      expect(typeof r.matchOffset).toBe('number');
    }
  });

  it('q 少于 2 字符返回 400', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=林&upto=1` });
    expect(res.statusCode).toBe(400);
  });

  it('不带 upto 时按 furthest 过滤', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=匿名信` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(1); // furthest=1，第 2 章不可见
  });

  it('单章命中超过 5 处只返回 5 条且 truncated=true', async () => {
    const longContent = Array.from({ length: 8 }, (_, i) => `第${i}处线索出现了。`).join('填充文字。');
    db.prepare('UPDATE chapters SET content = ?, word_count = LENGTH(?) WHERE book_id = ? AND idx = 0')
      .run(longContent, longContent, bookId);
    const res = await app.inject({ method: 'GET', url: `/api/books/${bookId}/search?q=线索&upto=0` });
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(5);
    expect(body.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/routes/search.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `server/src/routes/search.js`：

```js
import { badRequest, notFound } from '../errors.js';

const SNIPPET_RADIUS = 40;
const PER_CHAPTER_LIMIT = 5;
const TOTAL_LIMIT = 100;

export async function registerSearchRoutes(app, { db }) {
  app.get('/api/books/:id/search', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const book = db.prepare('SELECT id, total_chapters FROM books WHERE id = ?').get(bookId);
    if (!book) throw notFound('书籍不存在。');

    const q = String(request.query.q ?? '').trim();
    if (q.length < 2) throw badRequest('搜索词至少 2 个字符。');
    if (q.length > 50) throw badRequest('搜索词最长 50 个字符。');

    let upto;
    if (request.query.upto != null) {
      const parsed = Number(request.query.upto);
      if (!Number.isInteger(parsed) || parsed < 0) throw badRequest('upto 必须是非负整数。');
      upto = Math.min(parsed, book.total_chapters - 1);
    } else {
      const progress = db.prepare('SELECT furthest_chapter FROM reading_progress WHERE book_id = ?').get(bookId);
      upto = progress?.furthest_chapter ?? 0;
    }

    const chapters = db.prepare(`
      SELECT idx, title, content FROM chapters
      WHERE book_id = ? AND idx <= ? AND instr(content, ?) > 0
      ORDER BY idx ASC
    `).all(bookId, upto, q);

    const results = [];
    let truncated = false;
    for (const chapter of chapters) {
      let from = 0;
      let hits = 0;
      while (results.length < TOTAL_LIMIT) {
        const at = chapter.content.indexOf(q, from);
        if (at === -1) break;
        if (hits >= PER_CHAPTER_LIMIT) {
          truncated = true;
          break;
        }
        const start = Math.max(0, at - SNIPPET_RADIUS);
        const end = Math.min(chapter.content.length, at + q.length + SNIPPET_RADIUS);
        results.push({
          chapterIdx: chapter.idx,
          title: chapter.title,
          snippet: `${start > 0 ? '…' : ''}${chapter.content.slice(start, end)}${end < chapter.content.length ? '…' : ''}`,
          matchOffset: at
        });
        hits += 1;
        from = at + q.length;
      }
      if (results.length >= TOTAL_LIMIT) {
        truncated = true;
        break;
      }
    }

    return { results, truncated, upto };
  });
}

function numberParam(value, name) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw badRequest(`${name} 必须是非负整数。`);
  return num;
}
```

`server/src/index.js`：import 区加 `import { registerSearchRoutes } from './routes/search.js';`，在 `await registerGraphRoutes(app, { db });` 之后加 `await registerSearchRoutes(app, { db });`

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd server && npx vitest run src/routes/search.test.js` → 5 passed

```bash
git add server/src/routes/search.js server/src/routes/search.test.js server/src/index.js
git commit -m "feat(search): spoiler-safe full-text search within read chapters"
```

---

### Task 6: bookmarks CRUD 接口

**Files:**
- Create: `server/src/routes/bookmarks.js`
- Modify: `server/src/index.js`（注册）、`server/src/routes/books.js:204`（级联删除）
- Test: `server/src/routes/bookmarks.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/src/routes/bookmarks.test.js`：

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { installErrorHandler } from '../errors.js';
import { registerBookmarkRoutes } from './bookmarks.js';
import { deleteBookData } from './books.js';

describe('bookmarks', () => {
  let tempDir;
  let db;
  let app;
  let bookId;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-bookmarks-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await registerBookmarkRoutes(app, { db });
    await app.ready();
    bookId = Number(db.prepare(`
      INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
      VALUES ('书签书', null, 'txt', 3, 'done', 3, ?)
    `).run(nowIso()).lastInsertRowid);
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('增删查书签', async () => {
    const created = JSON.parse((await app.inject({
      method: 'POST',
      url: `/api/books/${bookId}/bookmarks`,
      payload: { chapter_idx: 1, scroll_pct: 0.42, note: '关键伏笔' }
    })).body);
    expect(created).toMatchObject({ chapter_idx: 1, scroll_pct: 0.42, note: '关键伏笔' });

    const list = JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/bookmarks` })).body);
    expect(list.length).toBe(1);

    await app.inject({ method: 'DELETE', url: `/api/books/${bookId}/bookmarks/${created.id}` });
    expect(JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/bookmarks` })).body)).toEqual([]);
  });

  it('chapter_idx 非法返回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/books/${bookId}/bookmarks`,
      payload: { chapter_idx: 'x' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('删除书时级联清理书签', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/books/${bookId}/bookmarks`,
      payload: { chapter_idx: 0, scroll_pct: 0 }
    });
    deleteBookData(db, bookId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM bookmarks WHERE book_id = ?').get(bookId).count).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/routes/bookmarks.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `server/src/routes/bookmarks.js`：

```js
import { badRequest, notFound } from '../errors.js';
import { nowIso } from '../db.js';

export async function registerBookmarkRoutes(app, { db }) {
  app.get('/api/books/:id/bookmarks', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    ensureBook(db, bookId);
    return db.prepare(`
      SELECT id, chapter_idx, scroll_pct, note, created_at
      FROM bookmarks WHERE book_id = ? ORDER BY chapter_idx ASC, created_at ASC
    `).all(bookId);
  });

  app.post('/api/books/:id/bookmarks', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const book = ensureBook(db, bookId);
    const chapterIdx = Number(request.body?.chapter_idx);
    if (!Number.isInteger(chapterIdx) || chapterIdx < 0 || chapterIdx >= book.total_chapters) {
      throw badRequest('chapter_idx 必须是有效章节序号。');
    }
    const scrollPct = Math.max(0, Math.min(1, Number(request.body?.scroll_pct) || 0));
    const note = typeof request.body?.note === 'string' ? request.body.note.slice(0, 200) : null;
    const result = db.prepare(`
      INSERT INTO bookmarks (book_id, chapter_idx, scroll_pct, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(bookId, chapterIdx, scrollPct, note, nowIso());
    return db.prepare('SELECT id, chapter_idx, scroll_pct, note, created_at FROM bookmarks WHERE id = ?')
      .get(Number(result.lastInsertRowid));
  });

  app.delete('/api/books/:id/bookmarks/:bookmarkId', async (request) => {
    const bookId = numberParam(request.params.id, 'id');
    const bookmarkId = numberParam(request.params.bookmarkId, 'bookmarkId');
    ensureBook(db, bookId);
    const result = db.prepare('DELETE FROM bookmarks WHERE id = ? AND book_id = ?').run(bookmarkId, bookId);
    if (!result.changes) throw notFound('书签不存在。');
    return { ok: true };
  });
}

function ensureBook(db, id) {
  const book = db.prepare('SELECT id, total_chapters FROM books WHERE id = ?').get(id);
  if (!book) throw notFound('书籍不存在。');
  return book;
}

function numberParam(value, name) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw badRequest(`${name} 必须是非负整数。`);
  return num;
}
```

`server/src/routes/books.js` 第 204 行级联表清单改为：

```js
    for (const table of ['bookmarks', 'reading_progress', 'events', 'relationships', 'characters', 'chapters']) {
```

`server/src/index.js`：加 `import { registerBookmarkRoutes } from './routes/bookmarks.js';` 并在 search 注册后加 `await registerBookmarkRoutes(app, { db });`

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd server && npx vitest run src/routes/bookmarks.test.js` → 3 passed

```bash
git add server/src/routes/bookmarks.js server/src/routes/bookmarks.test.js server/src/routes/books.js server/src/index.js
git commit -m "feat(bookmarks): chapter bookmarks with scroll position and cascade delete"
```

---

### Task 7: graph nodes 补 aliases

**Files:**
- Modify: `server/src/routes/graph.js:8-13`
- Test: `server/src/routes/graph.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/src/routes/graph.test.js`：

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, nowIso } from '../db.js';
import { installErrorHandler } from '../errors.js';
import { registerGraphRoutes } from './graph.js';

describe('graph nodes', () => {
  let tempDir;
  let db;
  let app;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-graph-'));
    db = initDb({
      dataDir: tempDir,
      uploadDir: path.join(tempDir, 'uploads'),
      dbPath: path.join(tempDir, 'test.sqlite')
    });
    app = Fastify({ logger: false });
    installErrorHandler(app);
    await registerGraphRoutes(app, { db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('nodes 返回 aliases 数组，且按 upto 防剧透', async () => {
    const bookId = Number(db.prepare(`
      INSERT INTO books (title, author, source_format, total_chapters, import_status, analyzed_chapters, created_at)
      VALUES ('图书', null, 'txt', 3, 'done', 3, ?)
    `).run(nowIso()).lastInsertRowid);
    db.prepare(`INSERT INTO characters (book_id, name, aliases, identity, first_seen_chapter)
      VALUES (?, '李明远', '["老李"]', '教师', 0)`).run(bookId);
    db.prepare(`INSERT INTO characters (book_id, name, aliases, identity, first_seen_chapter)
      VALUES (?, '神秘人', '["影子"]', null, 2)`).run(bookId);
    db.prepare(`INSERT INTO reading_progress (book_id, current_chapter, furthest_chapter, updated_at)
      VALUES (?, 0, 0, ?)`).run(bookId, nowIso());

    const body = JSON.parse((await app.inject({ method: 'GET', url: `/api/books/${bookId}/graph?upto=0` })).body);
    expect(body.nodes.length).toBe(1);
    expect(body.nodes[0].aliases).toEqual(['老李']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/routes/graph.test.js`
Expected: FAIL（aliases undefined）

- [ ] **Step 3: 实现**

`graph.js` 的 nodes 查询（8-13 行）改为：

```js
    const nodes = db.prepare(`
      SELECT id, name, aliases, identity, first_seen_chapter
      FROM characters
      WHERE book_id = ? AND first_seen_chapter <= ?
      ORDER BY first_seen_chapter ASC, id ASC
    `).all(bookId, upto)
      .map((node) => ({ ...node, aliases: parseStringArray(node.aliases) }));
```

（`parseStringArray` 已在该文件底部定义，直接复用。）

- [ ] **Step 4: 运行确认通过，跑全量后端测试并提交**

Run: `cd server && npx vitest run` → all pass

```bash
git add server/src/routes/graph.js server/src/routes/graph.test.js
git commit -m "feat(graph): expose character aliases in graph nodes"
```

---

### Task 8: web 工作区接入 vitest + api.js 扩展

**Files:**
- Modify: `web/package.json`、`web/src/api.js`

- [ ] **Step 1: 给 web 加 vitest**

`web/package.json` 的 `scripts` 加 `"test": "vitest run"`，`devDependencies` 加 `"vitest": "^1.6.1"`。然后：

Run: `npm install`（根目录，workspaces 会装好）
Expected: 安装成功

- [ ] **Step 2: api.js 扩展**

在 `web/src/api.js` 的 `api` 对象中（`updateProgress` 之后）追加：

```js
  chapterList: (id) => fetchJson(`/books/${id}/chapters`),
  search: (id, q, upto) => fetchJson(`/books/${id}/search?q=${encodeURIComponent(q)}&upto=${upto}`),
  bookmarks: (id) => fetchJson(`/books/${id}/bookmarks`),
  addBookmark: (id, payload) =>
    fetchJson(`/books/${id}/bookmarks`, { method: "POST", body: JSON.stringify(payload) }),
  deleteBookmark: (id, bookmarkId) =>
    fetchJson(`/books/${id}/bookmarks/${bookmarkId}`, { method: "DELETE" }),
```

注意：`chapterList`、`search` 不显式传 `upto` 时由服务端按 furthest 兜底，调用方应显式传 furthest 以保证状态一致。

- [ ] **Step 3: 构建验证并提交**

Run: `npm run build -w web`
Expected: 构建成功

```bash
git add web/package.json package-lock.json web/src/api.js
git commit -m "feat(web): add vitest and api methods for toc/search/bookmarks"
```

---

### Task 9: 选区匹配纯函数 selectionLookup

**Files:**
- Create: `web/src/selectionLookup.js`
- Test: `web/src/selectionLookup.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `web/src/selectionLookup.test.js`：

```js
import { describe, expect, it } from "vitest";
import { buildLookup, matchSelection } from "./selectionLookup.js";

const nodes = [
  { id: 1, name: "李明远", aliases: ["老李"] },
  { id: 2, name: "石神", aliases: [] },
  { id: 3, name: "李小明", aliases: [] }
];

describe("matchSelection", () => {
  const lookup = buildLookup(nodes);

  it("精确匹配人名", () => {
    expect(matchSelection("石神", lookup)).toMatchObject({ id: 2, exact: true });
  });

  it("精确匹配别名", () => {
    expect(matchSelection("老李", lookup)).toMatchObject({ id: 1, exact: true });
  });

  it("宽松匹配：选区被唯一人名包含", () => {
    expect(matchSelection("明远", lookup)).toMatchObject({ id: 1, exact: false });
  });

  it("宽松匹配多候选时不命中（李明 同时含于 李明远/李小明 之外仅前者，验证唯一性逻辑）", () => {
    // "李" 同时是 李明远 / 李小明 的子串 → 多候选 → null
    expect(matchSelection("李", lookup)).toBeNull();
  });

  it("空白与超长选区不命中", () => {
    expect(matchSelection("  ", lookup)).toBeNull();
    expect(matchSelection("一二三四五六七八九十一二三", lookup)).toBeNull();
  });

  it("未收录名字不命中", () => {
    expect(matchSelection("汤川", lookup)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/selectionLookup.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `web/src/selectionLookup.js`：

```js
const MAX_SELECTION_LENGTH = 12;

// nodes: [{ id, name, aliases }] → { exactMap, entries }
export function buildLookup(nodes) {
  const exactMap = new Map();
  const entries = [];
  for (const node of nodes || []) {
    const names = [node.name, ...(Array.isArray(node.aliases) ? node.aliases : [])].filter(Boolean);
    for (const name of names) {
      exactMap.set(name, node);
      entries.push({ name, node });
    }
  }
  return { exactMap, entries };
}

// 返回 { ...node, exact } 或 null
export function matchSelection(rawText, lookup) {
  const text = (rawText || "").trim();
  if (!text || text.length > MAX_SELECTION_LENGTH) return null;

  const exactHit = lookup.exactMap.get(text);
  if (exactHit) return { ...exactHit, exact: true };

  const candidates = [];
  const seenIds = new Set();
  for (const { name, node } of lookup.entries) {
    if (name.includes(text) && !seenIds.has(node.id)) {
      seenIds.add(node.id);
      candidates.push(node);
    }
  }
  if (candidates.length === 1) return { ...candidates[0], exact: false };
  return null;
}
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `cd web && npx vitest run src/selectionLookup.test.js` → 6 passed

```bash
git add web/src/selectionLookup.js web/src/selectionLookup.test.js
git commit -m "feat(web): selection-to-character matching with unique loose match"
```

---

### Task 10: Reader 进度模型接线（furthest 状态 + footer 进度%）

**Files:**
- Modify: `web/src/pages/Reader.jsx`、`web/src/components/ReaderPane.jsx`

说明：前端无组件级测试基建，本任务及后续 UI 任务靠 `npm run build -w web` + 手动验收（Task 15）保障；纯逻辑已在 Task 9 覆盖。

- [ ] **Step 1: Reader.jsx 增加 furthest/percent 状态**

`Reader.jsx` state 区（`const [currentChapter, setCurrentChapter] = useState(0);` 之后）加：

```js
  const [furthestChapter, setFurthestChapter] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
```

`loadBook` 改为（续读跳 furthest）：

```js
  const loadBook = useCallback(async () => {
    const nextBook = await api.book(bookId);
    setBook(nextBook);
    setFurthestChapter(nextBook.furthest_chapter || 0);
    setCurrentChapter(nextBook.furthest_chapter || 0);
  }, [bookId]);
```

`changeChapter` 改为：

```js
  const changeChapter = async (nextIdx) => {
    if (!book) return;
    const bounded = Math.max(0, Math.min(nextIdx, book.total_chapters - 1));
    const saved = await api.updateProgress(bookId, bounded);
    setCurrentChapter(saved.current_chapter);
    setFurthestChapter(saved.furthest_chapter);
    setProgressPercent(saved.percent ?? 0);
    setBook((prev) => (prev ? { ...prev, current_chapter: saved.current_chapter, furthest_chapter: saved.furthest_chapter } : prev));
  };
```

首次加载也要拿 percent：在 `loadBook` 的 `useEffect` 后新增一个 effect：

```js
  useEffect(() => {
    api.progress(bookId).then((p) => {
      setProgressPercent(p.percent ?? 0);
      setFurthestChapter(p.furthest_chapter ?? 0);
    }).catch(() => {});
  }, [bookId]);
```

- [ ] **Step 2: ReaderPane footer 用全书字数百分比**

`ReaderPane` 新增 prop `progressPercent`（签名加在 `currentChapter,` 之后）。footer 中间块替换为：

```jsx
        <div className="flex-1 px-3 text-center">
          <div className={`mb-1.5 text-xs ${mutedClass}`}>
            第 {currentChapter + 1} / {total || "-"} 章 · 全书 {progressPercent}%
          </div>
          <div className={`mx-auto h-1 max-w-72 overflow-hidden rounded-full ${nightMode ? "bg-[#3a2f22]" : "bg-line"}`}>
            <div className="h-1 rounded-full bg-noir transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
```

并删除组件内不再使用的 `const percent = ...` 行。Reader.jsx 调用处传 `progressPercent={progressPercent}`。

- [ ] **Step 3: 构建验证并提交**

Run: `npm run build -w web`
Expected: 构建成功

```bash
git add web/src/pages/Reader.jsx web/src/components/ReaderPane.jsx
git commit -m "feat(web): resume at furthest chapter and show word-weighted progress"
```

---

### Task 11: TOC 章节目录抽屉

**Files:**
- Create: `web/src/components/TocDrawer.jsx`
- Modify: `web/src/pages/Reader.jsx`、`web/src/components/ReaderPane.jsx`（工具栏加按钮）

- [ ] **Step 1: 新建 TocDrawer 组件**

新建 `web/src/components/TocDrawer.jsx`：

```jsx
import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function TocDrawer({ open, bookId, currentChapter, furthestChapter, bookmarkChapters, onJump, onClose, nightMode }) {
  const [chapters, setChapters] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    api.chapterList(bookId)
      .then((list) => { if (active) { setChapters(list); setError(""); } })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [open, bookId, furthestChapter]);

  if (!open) return null;

  const panelClass = nightMode ? "bg-[#221d16] text-[#ece2cd] border-[#3a2f22]" : "bg-manila text-ink border-line";
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="章节目录">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className={`absolute left-0 top-0 flex h-full w-80 max-w-[85vw] flex-col border-r shadow-xl ${panelClass}`}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "inherit" }}>
          <span className="font-reader text-base font-semibold">章节目录</span>
          <button type="button" onClick={onClose} className="px-2 text-lg leading-none hover:text-noir">×</button>
        </div>
        {error && <div className="px-4 py-2 text-sm text-red-600">{error}</div>}
        <ul className="min-h-0 flex-1 overflow-y-auto py-2">
          {chapters.map((chapter) => {
            const isCurrent = chapter.idx === currentChapter;
            const isRead = chapter.idx <= furthestChapter;
            return (
              <li key={chapter.idx}>
                <button
                  type="button"
                  onClick={() => { onJump(chapter.idx); onClose(); }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-black/5 ${
                    isCurrent ? "font-semibold text-noir" : isRead ? "" : mutedClass
                  }`}
                >
                  <span className="shrink-0">{isCurrent ? "▸" : ""}</span>
                  <span className="truncate">
                    第 {chapter.idx + 1} 章{chapter.title ? ` · ${chapter.title}` : ""}
                  </span>
                  {bookmarkChapters?.has(chapter.idx) && <span className="ml-auto shrink-0">🔖</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: ReaderPane 工具栏加目录按钮**

`ReaderPane` 新增 prop `onOpenToc`。工具栏字号控件之前（`<div className={\`flex items-center rounded-md border...` 之前）加：

```jsx
            <button
              type="button"
              onClick={onOpenToc}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${controlClass} hover:border-noir hover:text-noir`}
            >
              ☰ 目录
            </button>
```

- [ ] **Step 3: Reader.jsx 接线**

state 加 `const [tocOpen, setTocOpen] = useState(false);`，import TocDrawer。`ReaderPane` 传 `onOpenToc={() => setTocOpen(true)}`。`<AiSettingsDialog ...>` 之前渲染：

```jsx
      <TocDrawer
        open={tocOpen}
        bookId={bookId}
        currentChapter={currentChapter}
        furthestChapter={furthestChapter}
        bookmarkChapters={bookmarkChapters}
        onJump={changeChapter}
        onClose={() => setTocOpen(false)}
        nightMode={nightMode}
      />
```

`bookmarkChapters` 在 Task 13 前先放占位：`const bookmarkChapters = useMemo(() => new Set(), []);`（Task 13 替换为真实数据）。

- [ ] **Step 4: 构建验证并提交**

Run: `npm run build -w web` → 成功

```bash
git add web/src/components/TocDrawer.jsx web/src/components/ReaderPane.jsx web/src/pages/Reader.jsx
git commit -m "feat(web): chapter toc drawer with spoiler-safe titles"
```

---

### Task 12: 搜索面板 + Cmd/Ctrl+F

**Files:**
- Create: `web/src/components/SearchPanel.jsx`
- Modify: `web/src/pages/Reader.jsx`、`web/src/components/ReaderPane.jsx`（工具栏加按钮）

- [ ] **Step 1: 新建 SearchPanel**

新建 `web/src/components/SearchPanel.jsx`：

```jsx
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function SearchPanel({ open, bookId, furthestChapter, onJump, onClose, nightMode }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setSearched(false);
      setTruncated(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const body = await api.search(bookId, q, furthestChapter);
        setResults(body.results);
        setTruncated(Boolean(body.truncated));
        setSearched(true);
        setError("");
      } catch (requestError) {
        setError(requestError.message);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [open, query, bookId, furthestChapter]);

  if (!open) return null;

  const panelClass = nightMode ? "bg-[#221d16] text-[#ece2cd] border-[#3a2f22]" : "bg-manila text-ink border-line";
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  function highlight(snippet) {
    const q = query.trim();
    const parts = snippet.split(q);
    return parts.flatMap((part, index) =>
      index === 0 ? [part] : [<mark key={index} className="bg-amber-200 text-ink">{q}</mark>, part]
    );
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="全文搜索">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`absolute right-0 top-0 flex h-full w-96 max-w-[90vw] flex-col border-l shadow-xl ${panelClass}`}>
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "inherit" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
            placeholder="搜索已读内容…（至少 2 字）"
            className={`min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none ${
              nightMode ? "border-[#3a2f22] bg-[#2a2219]" : "border-line bg-card"
            }`}
          />
          <button type="button" onClick={onClose} className="px-2 text-lg leading-none hover:text-noir">×</button>
        </div>
        {error && <div className="px-4 py-2 text-sm text-red-600">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {searched && results.length === 0 && (
            <div className={`px-4 py-6 text-sm ${mutedClass}`}>
              在已读范围内（前 {furthestChapter + 1} 章）未找到「{query.trim()}」。未读章节不参与搜索，以防剧透。
            </div>
          )}
          <ul>
            {results.map((result, index) => (
              <li key={`${result.chapterIdx}-${result.matchOffset}-${index}`}>
                <button
                  type="button"
                  onClick={() => { onJump(result.chapterIdx); onClose(); }}
                  className="w-full border-b px-4 py-3 text-left text-sm transition hover:bg-black/5"
                  style={{ borderColor: "inherit" }}
                >
                  <div className={`mb-1 text-xs ${mutedClass}`}>第 {result.chapterIdx + 1} 章{result.title ? ` · ${result.title}` : ""}</div>
                  <div className="leading-relaxed">{highlight(result.snippet)}</div>
                </button>
              </li>
            ))}
          </ul>
          {truncated && <div className={`px-4 py-3 text-xs ${mutedClass}`}>结果过多，仅显示部分匹配。</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ReaderPane 工具栏加搜索按钮、Reader.jsx 接线 + Cmd+F**

`ReaderPane` 新增 prop `onOpenSearch`，目录按钮旁加：

```jsx
            <button
              type="button"
              onClick={onOpenSearch}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${controlClass} hover:border-noir hover:text-noir`}
            >
              🔍 搜索
            </button>
```

`Reader.jsx`：state 加 `const [searchOpen, setSearchOpen] = useState(false);`，import SearchPanel，ReaderPane 传 `onOpenSearch={() => setSearchOpen(true)}`，TocDrawer 旁渲染：

```jsx
      <SearchPanel
        open={searchOpen}
        bookId={bookId}
        furthestChapter={furthestChapter}
        onJump={changeChapter}
        onClose={() => setSearchOpen(false)}
        nightMode={nightMode}
      />
```

Cmd/Ctrl+F 拦截（Reader.jsx 中新增 effect）：

```js
  useEffect(() => {
    function handleKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
```

- [ ] **Step 3: 构建验证并提交**

Run: `npm run build -w web` → 成功

```bash
git add web/src/components/SearchPanel.jsx web/src/components/ReaderPane.jsx web/src/pages/Reader.jsx
git commit -m "feat(web): spoiler-safe search panel with cmd+f shortcut"
```

---

### Task 13: 书签 UI（添加 + 列表 + 跳转恢复滚动）

**Files:**
- Create: `web/src/components/BookmarkPanel.jsx`
- Modify: `web/src/pages/Reader.jsx`、`web/src/components/ReaderPane.jsx`

- [ ] **Step 1: ReaderPane 暴露滚动容器与摘录**

`ReaderPane` 改动三处：

(1) 接收新 props：`articleRef`（滚动容器 ref，由 Reader 传入）、`onAddBookmark`。

(2) `<article>` 加 ref：`<article ref={articleRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-10">`。

(3) 工具栏搜索按钮旁加：

```jsx
            <button
              type="button"
              onClick={onAddBookmark}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${controlClass} hover:border-noir hover:text-noir`}
            >
              🔖 书签
            </button>
```

- [ ] **Step 2: 新建 BookmarkPanel**

新建 `web/src/components/BookmarkPanel.jsx`：

```jsx
export default function BookmarkPanel({ open, bookmarks, onJump, onDelete, onClose, nightMode }) {
  if (!open) return null;
  const panelClass = nightMode ? "bg-[#221d16] text-[#ece2cd] border-[#3a2f22]" : "bg-manila text-ink border-line";
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="书签列表">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`absolute right-0 top-0 flex h-full w-96 max-w-[90vw] flex-col border-l shadow-xl ${panelClass}`}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "inherit" }}>
          <span className="font-reader text-base font-semibold">书签</span>
          <button type="button" onClick={onClose} className="px-2 text-lg leading-none hover:text-noir">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {bookmarks.length === 0 && <div className={`px-4 py-6 text-sm ${mutedClass}`}>还没有书签。阅读时点工具栏「🔖 书签」即可标记当前位置。</div>}
          <ul>
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id} className="flex items-stretch border-b" style={{ borderColor: "inherit" }}>
                <button
                  type="button"
                  onClick={() => { onJump(bookmark); onClose(); }}
                  className="min-w-0 flex-1 px-4 py-3 text-left text-sm transition hover:bg-black/5"
                >
                  <div className={`mb-1 text-xs ${mutedClass}`}>
                    第 {bookmark.chapter_idx + 1} 章 · {new Date(bookmark.created_at).toLocaleString()}
                  </div>
                  <div className="truncate">{bookmark.note || "（无备注）"}</div>
                </button>
                <button
                  type="button"
                  aria-label="删除书签"
                  onClick={() => onDelete(bookmark.id)}
                  className={`px-3 text-sm ${mutedClass} hover:text-red-600`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Reader.jsx 接线（添加书签 = 滚动位置 + 自动摘录）**

`Reader.jsx`：

```js
  const articleRef = useRef(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const pendingScrollRef = useRef(null);

  const loadBookmarks = useCallback(async () => {
    try { setBookmarks(await api.bookmarks(bookId)); } catch { /* 列表失败不阻塞阅读 */ }
  }, [bookId]);

  useEffect(() => { loadBookmarks(); }, [loadBookmarks]);

  const bookmarkChapters = useMemo(
    () => new Set(bookmarks.map((bookmark) => bookmark.chapter_idx)),
    [bookmarks]
  );  // 替换 Task 11 的占位

  async function addBookmark() {
    const el = articleRef.current;
    const scrollPct = el && el.scrollHeight > el.clientHeight
      ? el.scrollTop / (el.scrollHeight - el.clientHeight)
      : 0;
    const note = excerptVisibleParagraph(el);
    await api.addBookmark(bookId, { chapter_idx: currentChapter, scroll_pct: scrollPct, note });
    await loadBookmarks();
    setBookmarkOpen(true);
  }

  function excerptVisibleParagraph(el) {
    if (!el) return null;
    const containerTop = el.getBoundingClientRect().top;
    for (const p of el.querySelectorAll("p")) {
      const rect = p.getBoundingClientRect();
      if (rect.bottom > containerTop) return p.textContent.slice(0, 30);
    }
    return null;
  }

  async function jumpToBookmark(bookmark) {
    pendingScrollRef.current = bookmark.scroll_pct;
    await changeChapter(bookmark.chapter_idx);
  }

  // 章节内容渲染后恢复滚动位置
  useEffect(() => {
    if (pendingScrollRef.current == null || !chapter) return;
    const el = articleRef.current;
    if (el) el.scrollTop = pendingScrollRef.current * (el.scrollHeight - el.clientHeight);
    pendingScrollRef.current = null;
  }, [chapter]);
```

ReaderPane 传 `articleRef={articleRef}` `onAddBookmark={addBookmark}`；渲染：

```jsx
      <BookmarkPanel
        open={bookmarkOpen}
        bookmarks={bookmarks}
        onJump={jumpToBookmark}
        onDelete={async (bookmarkId) => { await api.deleteBookmark(bookId, bookmarkId); await loadBookmarks(); }}
        onClose={() => setBookmarkOpen(false)}
        nightMode={nightMode}
      />
```

注意：普通切章（非书签跳转）需重置滚动到顶部——在 `changeChapter` 内 `setCurrentChapter` 之后加：

```js
    if (pendingScrollRef.current == null && articleRef.current) articleRef.current.scrollTop = 0;
```

- [ ] **Step 4: 构建验证并提交**

Run: `npm run build -w web` → 成功

```bash
git add web/src/components/BookmarkPanel.jsx web/src/components/ReaderPane.jsx web/src/pages/Reader.jsx
git commit -m "feat(web): bookmarks with scroll position and auto excerpt"
```

---

### Task 14: 选中即查浮层档案卡 + 未命中提示 + 首次引导

**Files:**
- Create: `web/src/components/SelectionDossier.jsx`
- Modify: `web/src/components/ReaderPane.jsx`、`web/src/pages/Reader.jsx`

- [ ] **Step 1: 新建 SelectionDossier**

新建 `web/src/components/SelectionDossier.jsx`：

```jsx
import { useEffect, useRef } from "react";
import DossierCard from "./DossierCard.jsx";

// anchor: { x, y }（viewport 坐标）；character: 命中的人物节点；miss: 未命中提示文本或 null
export default function SelectionDossier({ bookId, character, miss, anchor, currentChapter, onOpenFull, onClose, nightMode }) {
  const boxRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) onClose();
    }
    if (character || miss) {
      window.addEventListener("pointerdown", handlePointerDown);
      return () => window.removeEventListener("pointerdown", handlePointerDown);
    }
  }, [character, miss, onClose]);

  useEffect(() => {
    if (!miss) return;
    const timer = setTimeout(onClose, 1500);
    return () => clearTimeout(timer);
  }, [miss, onClose]);

  if (!anchor || (!character && !miss)) return null;

  const style = {
    position: "fixed",
    left: Math.min(anchor.x, window.innerWidth - 340),
    top: Math.min(anchor.y + 12, window.innerHeight - 80),
    zIndex: 50
  };

  if (miss) {
    return (
      <div style={style} className={`rounded-md border px-3 py-1.5 text-sm shadow-lg ${
        nightMode ? "border-[#3a2f22] bg-[#2a2219] text-[#b6a384]" : "border-line bg-card text-steel"
      }`}>
        {miss}
      </div>
    );
  }

  return (
    <div ref={boxRef} style={style} className="w-80 max-w-[90vw]">
      <div className="relative max-h-[60vh] overflow-y-auto rounded-md shadow-2xl">
        <DossierCard
          bookId={bookId}
          character={character}
          currentChapter={currentChapter}
          onClose={onClose}
          nightMode={nightMode}
        />
      </div>
      <button
        type="button"
        onClick={() => { onOpenFull(character.id); onClose(); }}
        className={`mt-1 w-full rounded-md border px-3 py-1.5 text-xs font-semibold shadow ${
          nightMode ? "border-[#3a2f22] bg-[#2a2219] text-[#ece2cd]" : "border-line bg-card text-ink"
        } hover:border-noir hover:text-noir`}
      >
        查看完整卷宗 →
      </button>
    </div>
  );
}
```

注意：`DossierCard` 原是为右侧面板设计的绝对定位卡片——执行时先读 `DossierCard.jsx` 确认其外层定位样式；若其根元素是 `absolute` 定位，需在浮层容器里包一层 `relative` 容器（上面代码已包 `relative`）。如样式仍异常，允许给 DossierCard 加一个可选 `variant="popover"` prop 微调，但不得改动其数据逻辑。

- [ ] **Step 2: ReaderPane 选区监听**

`ReaderPane` 新增 prop `onTextSelect`。`<article>` 加 `onMouseUp`：

```jsx
      <article
        ref={articleRef}
        onMouseUp={() => {
          const selection = window.getSelection();
          const text = selection?.toString() ?? "";
          if (!text.trim()) return;
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          onTextSelect(text, { x: rect.left, y: rect.bottom });
        }}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-10"
      >
```

- [ ] **Step 3: Reader.jsx 接线 + 首次引导**

`Reader.jsx`：

```js
  import { buildLookup, matchSelection } from "../selectionLookup.js";
  import SelectionDossier from "../components/SelectionDossier.jsx";

  const [selectionHit, setSelectionHit] = useState(null);   // { character|null, miss|null, anchor }
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem("mr-selection-hint") === "1");

  const lookup = useMemo(() => buildLookup(graph.nodes), [graph.nodes]);

  function handleTextSelect(text, anchor) {
    const hit = matchSelection(text, lookup);
    if (hit) {
      setSelectionHit({ character: hit, miss: null, anchor });
    } else if (text.trim().length <= 12) {
      setSelectionHit({ character: null, miss: "未找到该人物", anchor });
    }
  }
```

ReaderPane 传 `onTextSelect={handleTextSelect}`；渲染（面板组件区）：

```jsx
      <SelectionDossier
        bookId={bookId}
        character={selectionHit?.character || null}
        miss={selectionHit?.miss || null}
        anchor={selectionHit?.anchor || null}
        currentChapter={currentChapter}
        onOpenFull={(charId) => { setSidePanelOpen(true); setSelectedCharacterId(charId); }}
        onClose={() => setSelectionHit(null)}
        nightMode={nightMode}
      />
```

首次引导条（`{error && ...}` 提示条之后）：

```jsx
      {!hintDismissed && (
        <div className={`flex shrink-0 items-center justify-between border-b px-5 py-2 text-sm ${
          nightMode ? "border-[#3a2f22] bg-[#2a2219] text-[#b6a384]" : "border-line bg-card text-steel"
        }`}>
          <span>💡 选中正文中的人名，可就地查看人物档案。</span>
          <button
            type="button"
            onClick={() => { localStorage.setItem("mr-selection-hint", "1"); setHintDismissed(true); }}
            className="px-2 font-semibold hover:text-noir"
          >
            知道了
          </button>
        </div>
      )}
```

- [ ] **Step 4: 构建验证、跑全部测试并提交**

Run: `npm run build -w web && cd web && npx vitest run && cd ../server && npx vitest run`
Expected: 构建成功，全部测试通过

```bash
git add web/src/components/SelectionDossier.jsx web/src/components/ReaderPane.jsx web/src/pages/Reader.jsx
git commit -m "feat(web): select-to-lookup character dossier with miss toast and first-run hint"
```

---

### Task 15: 手动验收 + README 更新

**Files:**
- Modify: `README.md`（功能表）

- [ ] **Step 1: 启动应用手动验收**

Run: `npm start`，按下列清单逐项验证：

1. 读到第 3 章 → 回看第 1 章 → 刷新页面：续读回第 3 章；footer「全书 N%」不倒退；右侧关系图只显示第 1 章数据（回看时）。
2. 目录：未读章只显示「第 N 章」灰显，已读章带标题；点击可跳章；书签章节带 🔖。
3. 搜索：Cmd+F 打开；搜后文才出现的词 → 空态文案含「已读范围」；结果点击跳章。
4. 书签：添加后自动带摘录；跳转恢复滚动位置（误差 < 1 屏）；删除即时生效。
5. 选中即查：选已读人物名/别名 → 弹卡；选未出场人物别名 → 「未找到该人物」轻提示；「查看完整卷宗」联动右侧面板；首次提示只出现一次。
6. 纯阅读模式（无 API Key 的书）：目录/搜索/书签/进度% 均可用，选中即查因无人物数据仅提示未找到。

- [ ] **Step 2: 更新 README 功能表**

`README.md` 功能介绍表格中追加四行（无截图先留 `-`）：

```markdown
| 📑 **章节目录** | 抽屉式目录，未读章节标题自动隐藏防剧透 | - |
| 🔎 **防剧透搜索** | Cmd+F 全文搜索，只搜已读范围 | - |
| 🔖 **书签** | 记录章内位置与自动摘录，一键跳回 | - |
| 👆 **选中即查** | 选中正文人名，就地弹出人物档案卡 | - |
```

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs(readme): document toc, search, bookmarks and select-to-lookup"
```

---

## Self-Review 记录

- **Spec 覆盖**：3.0 双指针→Task 1/3/10；3.1 选中即查→Task 7/9/14；3.2 搜索→Task 5/12；3.3 进度%+书签→Task 2/3/6/10/13；3.4 TOC→Task 4/11；量化验收→Task 15。无遗漏。
- **类型一致性**：`furthest_chapter`（snake_case，API 层）/`furthestChapter`（camelCase，React 层）贯穿一致；`registerSearchRoutes`/`registerBookmarkRoutes` 命名与 index.js 注册一致；`matchSelection` 返回 `{...node, exact}` 与 Task 14 用法一致。
- **已知取舍**：前端组件无单测（web 仅纯逻辑测试），靠构建 + Task 15 手动验收兜底。
