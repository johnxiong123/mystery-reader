# 簇① 阅读视图增强 — 设计文档

> 日期：2026-06-10
> 范围：mystery-reader 阅读页（Reader）增强，包含三项特性：A 选中即查档案卡、F 防剧透全文搜索、H 进度% + 书签。
> 这是「mystery-reader 改进路线图」的第 1 个簇（共 4 簇：① 阅读视图增强 / ② 关系图增强 / ③ 数据可信度 / ④ AI 前情提要）。后续簇各自独立成 spec。

## 1. 背景与目标

mystery-reader 是本地全栈悬疑小说阅读器：导入 txt/epub 后，后端在导入阶段调用 AI 抽取人物/关系/事件，阅读阶段只读本地 SQLite 并按当前章节做服务端防剧透过滤。

本簇聚焦**阅读体验**，三项特性都围绕"读正文时更顺手、不出戏、不剧透"：

- **A 选中即查档案卡**：读到某个名字想不起是谁时，选中即弹人物卡，不用切到右侧面板。
- **F 防剧透全文搜索**：在已读范围内全文检索，快速定位"上次某情节在哪一章"。
- **H 进度% + 书签**：显示阅读百分比，并支持标记/跳转书签。

### 核心不变量（不得违反）

- **阅读阶段零 AI 调用**：本簇所有功能纯走本地 SQLite，不触发任何 AI 请求。
- **服务端防剧透**：任何返回给前端的数据（人物、搜索片段）只包含 `当前章节 (upto)` 及之前的内容，绝不泄露未读章节。

## 2. 现状（已核查）

| 已有能力 | 位置 |
|---|---|
| `reading_progress` 表 + `GET/PUT /api/books/:id/progress`，记忆并续读 `current_chapter` | `server/src/routes/books.js` |
| graph `nodes` 已返回全部**可见**人物（id/name/identity/first_seen_chapter），按 `upto` 防剧透过滤 | `server/src/routes/graph.js` |
| `GET /api/books/:id/character/:charId?upto=` 人物详情接口 | `server/src/routes/graph.js` |
| `DossierCard` 自洽组件，入参 `{bookId, character, currentChapter, onClose, nightMode}`，自行拉取详情 | `web/src/components/DossierCard.jsx` |
| Reader 已管理 `selectedCharacterId` 并渲染 `DossierCard`，`graph.nodes` 已在前端状态中 | `web/src/pages/Reader.jsx` |
| 正文按段落渲染（`content.split(/\n{2,}/)` → `<p>{paragraph}</p>`） | `web/src/components/ReaderPane.jsx` |
| `characters` 表含 `aliases` 字段（当前 graph nodes 查询未 SELECT 它） | `server/src/db.js` |

结论：A 几乎是复用既有组件 + 一处后端字段补全；F 需新增一个搜索接口；H 进度%是纯前端派生、书签需新增一张表。

## 3. 详细设计

### 3.1 A — 选中即查档案卡

**触发交互**：用户在正文区域**选中文字**（`mouseup`），取选区文本 `trim` 后，在「name + aliases」映射表里查找：精确匹配优先，再退化到"选区恰好等于某个别名"。命中则在选区附近浮出 mini 档案卡；未命中无任何反应（正文保持零标记、零干扰）。

**数据来源**：复用前端已有的 `graph.nodes`（已按 `upto` 防剧透过滤）构建匹配表。需后端在 graph nodes 查询补 `aliases` 字段，使别名也能命中。

**渲染**：浮层（floating popup）锚定在选区位置，内容复用 `DossierCard`。选用浮层而非右侧面板的原因：全屏/纯阅读模式下右侧面板隐藏，浮层在所有模式都可用，也更符合"就地查询"直觉。卡片提供"查看完整卷宗"动作 → 联动 `onSelectCharacter` 高亮右侧面板对应人物。

**防剧透**：匹配表来自 `graph.nodes`（已过滤），未读章节才出场的人物/别名不在表中，选中也不会弹卡。

**组件边界**：
- 新增 `useTextSelectionLookup`（或在 ReaderPane 内联）：输入正文容器 ref + 人物匹配表，输出"命中人物 + 选区锚点坐标"。
- 新增浮层容器组件包裹 `DossierCard`，负责定位与点击外部关闭。
- 匹配纯前端、纯本地，无新接口。

### 3.2 F — 防剧透全文搜索

**后端**：新增 `GET /api/books/:id/search?q=&upto=`
- SQL 仅扫 `chapters WHERE book_id = ? AND idx <= resolveUpto(...)`，守住防剧透不变量。
- 用 `LIKE` / `instr` 定位匹配位置，在 JS 层截取匹配前后文片段。
- 不使用 FTS5，避免 better-sqlite3 编译/扩展风险；本地单用户、书体量适中，`LIKE` 扫描足够。
- 返回 `[{ chapterIdx, title, snippet, matchOffset }]`，按章节顺序。
- 空 `q` 返回空列表；做基本长度上限保护。

**前端**：工具栏新增搜索图标 → 弹出搜索框 + 结果列表（按章节分组、关键词高亮）→ 点击结果跳转到该章，并尽量滚动到匹配处（滚动到匹配为加分项，章节跳转为必须项）。

### 3.3 H — 进度% + 书签

**进度%**：基于已有 `current_chapter` 与 `total_chapters` 派生 `(current_chapter + 1) / total_chapters`，在工具栏/页脚显示百分比。纯前端，零后端改动。

**书签**：
- 新增表 `bookmarks(id INTEGER PK, book_id INTEGER, chapter_idx INTEGER, note TEXT, created_at TEXT)`。
- 新增接口：
  - `GET /api/books/:id/bookmarks` 列出书签
  - `POST /api/books/:id/bookmarks` 新增（body: `chapter_idx`, 可选 `note`）
  - `DELETE /api/books/:id/bookmarks/:bookmarkId` 删除
- 前端：工具栏"加书签"按钮 + 书签列表（点击跳转对应章）。
- 范围限定：章节级书签，不做段落级精确定位（YAGNI）。
- 删除书：清理书签需加入 `delete book` 的级联表清单（当前 `['reading_progress','events','relationships','characters','chapters']`，补 `'bookmarks'`）。

## 4. 改动汇总

| 层 | 改动 |
|---|---|
| `server/src/db.js` | 新增 `bookmarks` 表；删除书的级联清单补 `bookmarks` |
| `server/src/routes/graph.js` | graph nodes 查询 SELECT 补 `aliases` |
| `server/src/routes/books.js`（或新 route 文件） | 新增 `/search`；新增 bookmarks 三接口 |
| `web/src/components/ReaderPane.jsx` | 选区监听 + 浮层档案卡触发 |
| `web/src/pages/Reader.jsx` | 接线选区命中 → 档案卡/面板联动；进度%；书签 UI；搜索面板入口 |
| 新前端组件 | 浮层档案卡容器、搜索面板、书签列表 |

## 5. 测试与验收

**自动化测试**：
- `/search` 防剧透单测：构造 `upto=N`，断言结果中不含 `idx > N` 章节的内容。
- 选区匹配逻辑单测：精确名 / 别名命中、未读人物不命中、空选区/噪声选区不命中。
- bookmarks CRUD 单测：增删查、跨 book 隔离、删除书级联清理。

**手动验收要点**：
- 选中**未读**章节才出场人物的别名 → **不**弹卡；选中**已读**人物（名或别名）→ 弹卡。
- 搜索结果**绝不**包含当前章之后的任何内容。
- 进度%、书签跨应用重启保持。
- 全屏/纯阅读模式下选中即查仍可用（浮层）。

## 6. 不做（Out of Scope）

- 段落级/字符级精确书签定位。
- 跨书全局搜索。
- 搜索结果命中未读章节的"模糊提示"（与防剧透冲突）。
- FTS5 全文索引（按需再议）。
- 簇 ②③④ 的内容。
