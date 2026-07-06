# 簇① 阅读视图增强 — 设计文档（v3）

> 日期：2026-06-10（v2：吸收产品评审反馈；v3：并入 TOC 章节目录）
> 范围：mystery-reader 阅读页（Reader）增强：A 选中即查档案卡、F 防剧透全文搜索、H 进度% + 书签、T 章节目录（TOC），以及 P0 进度模型修正（furthest_chapter）。
> 这是「mystery-reader 改进路线图」的第 1 个簇（共 4 簇：① 阅读视图增强 / ② 关系图增强 / ③ 数据可信度 / ④ AI 前情提要）。后续簇各自独立成 spec。

## 1. 背景与目标

mystery-reader 是本地全栈悬疑小说阅读器：导入 txt/epub 后，后端在导入阶段调用 AI 抽取人物/关系/事件，阅读阶段只读本地 SQLite 并按当前章节做服务端防剧透过滤。

本簇聚焦**阅读体验**：

- **P0 进度模型修正**：引入「最远阅读位置」，回看旧章节不再丢进度。
- **A 选中即查档案卡**：读到某个名字想不起是谁时，选中即弹人物卡。
- **F 防剧透全文搜索**：在已读范围内全文检索，快速定位"上次某情节在哪一章"。
- **H 进度% + 书签**：按字数加权显示阅读百分比；书签支持章内位置与自动摘录。
- **T 章节目录（TOC）**：跳任意章的能力（已确认现状只有上一章/下一章），同时是搜索/书签跳转的导航基座。

### 核心不变量（不得违反）

- **阅读阶段零 AI 调用**：本簇所有功能纯走本地 SQLite，不触发任何 AI 请求。
- **服务端防剧透**：人物/关系/搜索片段只包含边界章节及之前的内容，绝不泄露未读章节。

## 2. 现状（已核查）

| 已有能力 | 位置 |
|---|---|
| `reading_progress` 表（仅 `current_chapter`）+ `GET/PUT /api/books/:id/progress` | `server/src/routes/books.js` |
| **已确认缺陷**：`changeChapter` 每次切章直接写回 `current_chapter`，回看旧章会使进度倒退、续读丢位置 | `web/src/pages/Reader.jsx:131` |
| graph `nodes` 返回全部**可见**人物（id/name/identity/first_seen_chapter），按 `upto` 防剧透过滤 | `server/src/routes/graph.js` |
| `GET /api/books/:id/character/:charId?upto=` 人物详情接口 | `server/src/routes/graph.js` |
| `DossierCard` 自洽组件，入参 `{bookId, character, currentChapter, onClose, nightMode}` | `web/src/components/DossierCard.jsx` |
| 正文按段落渲染（`content.split(/\n{2,}/)` → `<p>`） | `web/src/components/ReaderPane.jsx` |
| `characters` 表含 `aliases` 字段（graph nodes 查询暂未 SELECT 它） | `server/src/db.js` |

## 3. 详细设计

### 3.0 P0 — 进度模型：current 与 furthest 分离

**双指针语义**：

| 指针 | 含义 | 消费方 |
|---|---|---|
| `current_chapter` | 正在看的章节 | 防剧透边界（关系图/档案卡/时间线随当前章生长——回看第 3 章就看到第 3 章时点的图，这是核心特性，保持不变） |
| `furthest_chapter` | 历史最远读到的章节 | 搜索范围、进度%、续读点 |

**改动**：
- `reading_progress` 表新增 `furthest_chapter INTEGER NOT NULL DEFAULT 0`。
- 迁移：启动时 `ALTER TABLE ... ADD COLUMN`（带存在性保护），存量数据回填 `furthest_chapter = current_chapter`。
- `PUT /progress`：写入 `current_chapter = requested`，`furthest_chapter = MAX(furthest_chapter, requested)`。`GET` 同时返回两者。
- 前端：打开书续读跳 `furthest_chapter`；进度%与搜索用 `furthest`；右侧面板防剧透继续用 `current`。

### 3.1 A — 选中即查档案卡

**触发**：用户在正文选中文字（`mouseup`），选区 `trim` 后在「name + aliases」匹配表中查找：

1. **精确匹配**：选区 == 某 name 或 alias。
2. **宽松匹配**：选区被某 name/alias 包含（如选"李明"命中"李明远"），且**全表唯一命中**时生效；多个候选则不弹（避免误判）。
3. **未命中反馈**：浮出轻提示「未找到该人物」，约 1.5s 自动消失。提示文案对"人物不存在"和"人物尚未出场"**不做区分**——防剧透安全。
4. 空选区/超长选区（> 12 字符）不触发查找、不提示。

**发现性**：首次进入阅读页显示一次性提示条「💡 选中正文中的人名，可查看人物档案」，关闭后写 `localStorage` 标记不再出现。

**数据**：匹配表来自前端已有 `graph.nodes`（按 `current_chapter` 防剧透过滤——未出场人物不在表中，选中不弹卡）。后端在 graph nodes 查询补 `aliases` 字段。

**渲染**：浮层锚定选区位置，内容复用 `DossierCard`；点击外部关闭。浮层而非右侧面板：全屏/纯阅读模式下面板隐藏，浮层全模式可用。卡片提供"查看完整卷宗"→ 联动 `onSelectCharacter` 高亮右侧面板。

### 3.2 F — 防剧透全文搜索

**后端**：新增 `GET /api/books/:id/search?q=&upto=`
- `upto` 由前端传 `furthest_chapter`；服务端用 `resolveUpto` 兜底校验，SQL 仅扫 `chapters WHERE book_id = ? AND idx <= upto`。
- `LIKE`/`instr` 定位，JS 截取匹配前后文片段。不用 FTS5（避免编译/扩展风险；本地单用户 `LIKE` 足够）。
- 返回 `[{ chapterIdx, title, snippet, matchOffset }]`，按章节顺序；每章最多 5 条、总数上限 100，超限时返回 `truncated: true`。
- `q` 最少 2 字符，最长 50 字符；空/超限返回 400 或空列表。

**前端**：
- 工具栏搜索图标 + **拦截 `Cmd/Ctrl+F`** 打开应用内搜索（阅读页内 `keydown` 拦截并 `preventDefault`）。
- 输入防抖 300ms；结果按章节分组、关键词高亮；点击结果跳该章并尽量滚动到匹配处（滚动到匹配为加分项，跳章为必须）。
- **空态文案**：明确写「在已读范围内（前 N 章）未找到」，避免用户搜后文词汇时误以为搜索故障。

### 3.3 H — 进度% + 书签

**字数加权进度%**：
- `chapters` 表新增 `word_count INTEGER`，导入时计算（`content.length`，中文场景字符数≈字数）。
- 迁移：启动时为存量章节回填（一次性 `UPDATE ... SET word_count = LENGTH(content)`）。
- 进度% = `读完字数（idx < furthest 的章节字数和 + 当前估读） / 全书字数和`；简化实现：`SUM(word_count WHERE idx <= furthest) / SUM(word_count)`。
- 展示在工具栏/页脚，如「全书 42%」。

**书签**：
- 表：`bookmarks(id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL, chapter_idx INTEGER NOT NULL, scroll_pct REAL NOT NULL DEFAULT 0, note TEXT, created_at TEXT NOT NULL)`。
- `scroll_pct`：加书签时正文滚动容器的滚动百分比，跳转时恢复——章内近似定位，远便宜于段落级锚点。
- **自动摘录**：加书签时取当前视口第一个可见段落前 30 字作为默认 `note`（用户可改可清空）。
- 接口：`GET /api/books/:id/bookmarks`、`POST /api/books/:id/bookmarks`（body: `chapter_idx`, `scroll_pct`, `note?`）、`DELETE /api/books/:id/bookmarks/:bookmarkId`。
- 前端：工具栏"加书签"按钮 + 书签列表（显示章节、摘录、时间；点击跳转并恢复滚动位置）。
- 删除书：级联清理清单补 `bookmarks`。

### 3.4 T — 章节目录（TOC）

**后端**：新增 `GET /api/books/:id/chapters?upto=`（列表，不含 content）：
- 返回全部章节 `[{ idx, title }]`，但**未读章节（idx > upto，前端传 furthest）的 `title` 置空**，由服务端过滤——悬疑小说章节标题本身可能剧透（如"凶手现身"），守住服务端防剧透不变量。

**前端**：
- 工具栏目录按钮 → 抽屉式章节列表：已读章显示「第 N 章 · 标题」，未读章只显示「第 N 章」并灰显；标注当前章与书签所在章。
- 点击任意章跳转（复用 `changeChapter`）。允许跳到未读章（用户主动快进），跳转后 `furthest` 按 PUT /progress 语义自然跟进。
- 搜索结果、书签列表的跳转可复用同一跳章路径。

## 4. 改动汇总

| 层 | 改动 |
|---|---|
| `server/src/db.js` | `reading_progress` 加 `furthest_chapter`；`chapters` 加 `word_count`；新增 `bookmarks` 表；三项迁移/回填；删书级联补 `bookmarks` |
| `server/src/routes/books.js` | `PUT/GET /progress` 双指针；新增 `/search`；新增 bookmarks 三接口；新增 `/chapters` 列表（未读章 title 服务端置空）；导入流程写 `word_count` |
| `server/src/routes/graph.js` | nodes 查询补 `aliases` |
| `web/src/pages/Reader.jsx` | 续读/进度%/搜索改用 furthest；选区命中接线；搜索面板 + Cmd+F；书签 UI；首次提示 |
| `web/src/components/ReaderPane.jsx` | 选区监听 + 浮层档案卡 + 未命中轻提示 |
| 新前端组件 | 浮层档案卡容器、搜索面板、书签列表、章节目录抽屉、一次性提示条 |

## 5. 测试与验收

**自动化测试**：
- 进度双指针：`PUT progress` 回退章节后 `furthest` 不变、前进后 `furthest` 跟进；存量迁移回填正确。
- `/search` 防剧透：`upto=N` 时结果不含 `idx > N` 内容；`q` 长度边界；结果上限与 `truncated`。
- 选区匹配：精确命中、宽松唯一命中、宽松多候选不弹、未出场人物不命中、空/超长选区不触发。
- bookmarks CRUD：增删查、`scroll_pct` 持久化、跨 book 隔离、删书级联清理。
- `/chapters` 列表防剧透：`upto=N` 时 `idx > N` 的章节 `title` 为空。
- 字数回填：存量章节 `word_count` 非空且 = `LENGTH(content)`。

**量化验收指标**：

| 指标 | 阈值 | 测法 |
|---|---|---|
| 搜索响应（50 万字书） | < 300ms | 接口计时 |
| 选中到弹卡/提示 | < 100ms | 前端纯本地匹配，肉眼无感延迟 |
| 进度迁移 | 存量书打开零报错，furthest ≥ current | 迁移脚本断言 |
| 书签跳转恢复位置误差 | < 1 屏 | 手动验收 |

**手动验收要点**：
- 读到第 20 章 → 回看第 3 章 → 退出重进：续读回第 20 章、进度%不倒退、搜索范围仍是前 20 章；右侧关系图在回看时只显示前 3 章数据。
- 选中**未读**章节才出场人物的别名 → 提示「未找到该人物」（不泄露存在性）；选中已读人物名/别名 → 弹卡。
- Cmd/Ctrl+F 在阅读页打开应用内搜索而非浏览器搜索。
- 目录中未读章节不显示标题（仅「第 N 章」），已读章节显示完整标题。
- 首次提示只出现一次。

## 6. 不做（Out of Scope）

- 段落级/字符级精确书签锚点（scroll_pct 近似已够）。
- 跨书全局搜索。
- 搜索命中未读章节的任何形式提示（与防剧透冲突）。
- FTS5 全文索引。
- 阅读位置的章内自动记忆（仅书签手动记录；后续簇可议）。
- 簇 ②③④ 的内容。
