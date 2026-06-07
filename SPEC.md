# 工程规格说明（可执行 Spec）：悬疑小说「角色关系可视化」阅读器

> 本文件供执行 agent 直接照做。决策已全部敲定，凡标「MUST」为强制要求。配套背景见 PRD（决策同源，已并入本文 §1）。
>
> 版本说明：v0.1 已移除「猜凶手/预测」玩法及配套的真凶(culprit)识别，相关能力顺延至 v2（见 §12）。

---

## 1. 项目概述与约束

- **目标**：本地全栈 Web 应用。导入悬疑小说 → AI 逐章抽取人物/关系/事件入库 → 阅读时右侧关系图按进度生长、严格防剧透；含人物档案卡、事件时间线、人物一览、关系揭露动画。
- **运行方式（MUST）**：`git clone` 后 `npm install && npm start`，单端口启动并自动打开浏览器。
- **AI（MUST）**：用户自带 Key，OpenAI 兼容接口，`base_url`/`model`/`key` 全部从 `.env` 读取。AI 仅在导入时调用，阅读阶段零 AI 调用。
- **数据（MUST）**：全部本地存储（SQLite + 本地文件）。Key 仅存后端，禁止进入前端代码或日志。
- **运行环境（MUST）**：Node >= 20，跨 macOS/Linux/Windows。

### 1.1 防剧透核心不变量（MUST，全局贯穿）
任何返回给前端的人物/关系/事件，MUST 经过 `uptoChapter` 过滤：
- 人物可见 ⇔ `first_seen_chapter <= uptoChapter`
- 关系可见 ⇔ `reveal_chapter <= uptoChapter`
- 事件可见 ⇔ `reveal_chapter <= uptoChapter`（注意按 `reveal_chapter` 过滤，按 `occur_chapter` 排序）

后端 API MUST 在服务端完成过滤，禁止把未揭露数据下发到前端再隐藏。

---

## 2. 技术栈与版本（MUST）

| 用途 | 包 | 说明 |
|---|---|---|
| 后端框架 | `fastify` ^4 | + `@fastify/static` 托管前端、`@fastify/multipart` 上传 |
| 数据库 | `better-sqlite3` ^11 | 同步 API，单文件 |
| epub 解析 | `epub2` ^3 | 读章节与正文 |
| AI 客户端 | `openai` ^4 | 配 `baseURL` 即兼容各家 |
| 前端 | `react` ^18 + `vite` ^5 | |
| 关系图 | 原生 Canvas 2D 自绘力导向图 | 不新增图谱依赖 |
| 样式 | `tailwindcss` ^3 | |
| 进程编排 | `concurrently`（dev）、`open`（启动开浏览器） | |
| 测试 | `vitest` | 后端逻辑单测 |

包管理：npm workspaces（根 `package.json` 含 `server`、`web` 两个 workspace）。

---

## 3. 目录结构（MUST 照建）

```
mystery-reader/
├─ package.json              # 根：workspaces + scripts(start/dev/test)
├─ .env.example             # AI_API_KEY / AI_BASE_URL / AI_MODEL / PORT
├─ .gitignore              # data/ .env node_modules web/dist
├─ README.md
├─ server/
│  ├─ package.json
│  └─ src/
│     ├─ index.js          # Fastify 启动；注册路由；生产托管 web/dist；open 浏览器
│     ├─ db.js             # better-sqlite3 连接 + 建表(迁移)
│     ├─ config.js         # 读取 .env，校验 Key
│     ├─ routes/
│     │  ├─ books.js       # 导入/列表/详情/进度
│     │  └─ graph.js       # graph/character/timeline
│     ├─ ingest/
│     │  ├─ parseEpub.js   # epub -> {title,author,chapters[]}
│     │  ├─ parseTxt.js    # txt 正则分章，失败按长度切块
│     │  └─ extractor.js   # 逐章 AI 抽取 + 去重合并 + 入库 + 进度事件
│     └─ ai/
│        ├─ client.js      # openai 实例
│        └─ prompt.js      # 抽取 prompt 模板 + JSON schema 校验
└─ web/
   ├─ package.json
   ├─ index.html
   ├─ vite.config.js       # dev 代理 /api -> server
   └─ src/
      ├─ main.jsx, App.jsx
      ├─ api.js            # fetch 封装
      ├─ pages/
      │  ├─ Library.jsx    # 3D 书架（coverflow 轮播）+ 导入
      │  └─ Reader.jsx     # 阅读页（左右分栏）
      └─ components/
         ├─ ReaderPane.jsx     # 正文/翻页/字号/夜间
         ├─ GraphView.jsx      # Canvas 关系图 + 揭露动画
         ├─ TimelineView.jsx   # 事件时间线
         ├─ CharacterList.jsx  # 人物一览
         ├─ DossierCard.jsx    # 人物档案卡
         └─ ImportProgress.jsx # SSE 进度条
```

`npm start`（MUST）：先 `vite build` 产出 `web/dist`，再启动 Fastify（单端口，默认 8787）同时托管静态前端与 `/api`，并 `open` 浏览器。
`npm run dev`：`concurrently` 跑 `vite`(前端热更) + `node --watch server`（前端代理 /api 到后端）。

---

## 4. 数据库 Schema（MUST，建表 DDL）

```sql
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  source_format TEXT,              -- 'epub' | 'txt'
  total_chapters INTEGER NOT NULL,
  import_status TEXT NOT NULL,      -- 'parsing'|'extracting'|'done'|'error'
  analyzed_chapters INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,            -- 0-based 章序
  title TEXT,
  content TEXT NOT NULL,
  extract_status TEXT DEFAULT 'pending', -- 'pending'|'done'|'error'
  UNIQUE(book_id, idx)
);
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,                    -- JSON array string
  identity TEXT,
  first_seen_chapter INTEGER NOT NULL
);
CREATE TABLE relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  from_char_id INTEGER NOT NULL,
  to_char_id INTEGER NOT NULL,
  type TEXT NOT NULL,             -- 关系类型（中文，如 邻居/暗恋/兄妹）
  reveal_chapter INTEGER NOT NULL,
  description TEXT
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  occur_chapter INTEGER NOT NULL,  -- 事件实际发生章（可早于揭露）
  reveal_chapter INTEGER NOT NULL, -- 读者读到/被揭露章
  involved_char_ids TEXT           -- JSON array string
);
CREATE TABLE reading_progress (
  book_id INTEGER PRIMARY KEY,
  current_chapter INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
```

---

## 5. AI 抽取规格（MUST）

### 5.1 流程
1. 书入库后 `import_status='extracting'`。
2. 按 `idx` 升序逐章处理；每章：
   - 若 `content` 字符数 > 12000，按段落边界切成 ≤12000 的子块，逐块抽取后合并。
   - 调 AI，输入：本章正文 + 当前章号 + **已知人物列表**（name+aliases，用于去重消歧）。
   - 解析并校验 JSON（§5.3）；失败重试最多 2 次；仍失败则该章 `extract_status='error'`，**跳过不阻塞后续**。
   - 合并入库（§5.4），`analyzed_chapters++`，推送 SSE 进度。
3. 全部完成 `import_status='done'`。

### 5.2 抽取 Prompt 模板（prompt.js）
系统提示要点（MUST 包含）：
- 角色：你是中文小说信息抽取器，只输出 JSON，不输出解释。
- 任务：基于「本章正文」抽取**本章新出现/新揭露**的人物、关系、事件。
- 去重：给出「已知人物」，同一人用其既有规范名，不要重复创建；新人物才新增。
- 章节标记规则（关键）：
  - 人物 `first_seen_chapter` = 当前章号。
  - 关系/事件 `reveal_chapter` = 当前章号（即本章读者才知道）。
  - 事件 `occur_chapter` = 事件**实际发生**的章号；若本章揭露的是过去发生的事（倒叙/回忆），`occur_chapter` 填其真实发生章号，否则等于当前章号。

### 5.3 AI 输出 JSON Schema（MUST 校验）
```json
{
  "characters": [
    {"name": "石神哲哉", "aliases": ["石神"], "identity": "高中数学老师"}
  ],
  "relationships": [
    {"from": "石神哲哉", "to": "靖子", "type": "邻居", "description": "住隔壁"}
  ],
  "events": [
    {"description": "石神帮靖子处理尸体", "occur_chapter": 2, "involved": ["石神哲哉","靖子"]}
  ]
}
```
- `name`/`from`/`to`/`type`/`description`/相应字段为必填字符串；数组允许为空。
- `occur_chapter` 为整数；缺省视为当前章。
- 校验失败即触发重试。

### 5.4 入库与去重逻辑（extractor.js）
- 人物：按 `(book_id, name 或命中 aliases)` 查重；命中则补全空字段，不新建；未命中插入，`first_seen_chapter=当前章`。
- 关系：用解析后的人物 id 落 `from_char_id/to_char_id`；同一对人物同 type 已存在则跳过（去重），`reveal_chapter` 取首次出现章。
- 事件：直接插入，`occur_chapter` 用 AI 给的值，`reveal_chapter=当前章`，`involved_char_ids` 映射为 id 数组。

---

## 6. API 契约（MUST，前缀 `/api`）

| 方法 | 路径 | 说明 | 返回 |
|---|---|---|---|
| POST | `/books/import` | multipart 上传 epub/txt；同步解析分章入库后异步起抽取 | `{ bookId }` |
| GET | `/books` | 书架列表 | `[{id,title,author,total_chapters,import_status,analyzed_chapters}]` |
| GET | `/books/:id` | 书详情 | `{...book, current_chapter}` |
| GET | `/books/:id/import-progress` | **SSE**，推送抽取进度 | event: `{analyzed,total,status}`，done 时关闭 |
| GET | `/books/:id/chapters/:idx` | 章节正文 | `{idx,title,content}` |
| GET | `/books/:id/graph?upto=N` | 过滤后的图 | `{nodes:[{id,name,identity,first_seen_chapter}], edges:[{id,source,target,type,reveal_chapter,description}]}` |
| GET | `/books/:id/character/:charId?upto=N` | 档案卡 | `{name,aliases,identity,first_seen_chapter,relationships:[...],events:[...]}`（均按 upto 过滤） |
| GET | `/books/:id/timeline?upto=N` | 时间线 | `[{description,occur_chapter,reveal_chapter,involved:[name]}]` 按 occur_chapter 升序 |
| GET | `/books/:id/progress` / PUT | 读进度 | `{current_chapter}` |
| POST | `/books/:id/chapters/:idx/reextract` | 重抽失败章 | `{ok}` |

- `upto` 缺省取该书当前进度。所有 graph/character/timeline 接口 MUST 应用 §1.1 过滤。
- 错误统一 `{error: {code,message}}`，HTTP 4xx/5xx。

---

## 7. 前端规格（MUST）

- **Library.jsx**：3D 书架（coverflow 轮播，拖拽/滚轮/方向键切换，居中为精选书）+ 文件导入。书的数量与实际一致，不重复填充。导入中显示 `ImportProgress`（订阅 SSE）。
- **Reader.jsx**：左右分栏。左 `ReaderPane`，右侧顶部 Tab 切 `GraphView`/`TimelineView`/`CharacterList`（关系图谱/时间线/人物一览）。进度变化时刷新右侧（带 `upto=current_chapter`）。
- **ReaderPane.jsx**：渲染 `content`；上一章/下一章；字号调节；夜间模式（class 切换）；翻到新章时 PUT 进度。
- **GraphView.jsx**：Canvas 2D 自绘力导向布局；节点=人物，边=关系（按 type 着色，多关系拆成平行方向线）；点击节点 → `DossierCard`。**揭露动画**：对 `reveal_chapter === current_chapter` 的边/点触发一次高亮和粒子爆开。
- **TimelineView.jsx**：竖向时间线，事件按 `occur_chapter` 排列，标注发生章；若 `occur_chapter < reveal_chapter` 视觉上标「倒叙」。
- **DossierCard.jsx**：弹层展示档案卡数据。
- **CharacterList.jsx**：人物一览，列出当前进度可见人物，点选与关系图联动。

---

## 8. 配置文件

`.env.example`（MUST）：
```
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.openai.com/v1   # 兼容接口可改，如国内大模型
AI_MODEL=gpt-4o-mini
PORT=8787
```
`config.js` 启动时校验 `AI_API_KEY` 存在，缺失则抛出可读错误并提示去 `.env` 配置。

---

## 9. 验收标准（Given/When/Then，逐条 MUST 通过）

**AC1 启动**：Given clone 并 `npm install`，配好 `.env`；When `npm start`；Then 自动打开浏览器到书架页，无控制台报错。

**AC2 导入与边抽边读**：Given 一本 ≥10 章 txt；When 导入；Then 进度条显示 `已分析 X/总章`，且**已分析章节可立即打开阅读**，无需等全书完成。

**AC3 防剧透（核心）**：Given 进度=第3章；When 打开关系图/档案卡/时间线；Then 仅出现 `first_seen/reveal_chapter <= 3` 的人物/关系/事件；用 DevTools 检查接口响应**不含**未揭露数据。

**AC4 随读生长**：Given 从第3章翻到第4章；When 进度更新；Then 关系图据新进度新增对应节点/连线。

**AC5 揭露动画**：Given 某关系 `reveal_chapter=12`；When 进度到第12章打开关系图；Then 该连线高亮闪烁一次。

**AC6 档案卡**：When 点击节点；Then 弹出档案卡，内容仅含 ≤当前章 的关系与事件。

**AC7 时间线**：Given 含倒叙事件（occur < reveal）；When 看时间线；Then 事件按 occur_chapter 排序，倒叙项被标注。

**AC8 健壮性**：Given 某章 AI 返回非法 JSON；When 抽取；Then 重试后仍失败则该章标 error 且**其余章节正常完成**，可调重抽接口恢复。

**AC9 隐私**：grep 前端构建产物与日志，**不得**出现 API Key。

---

## 10. 测试计划（vitest，后端）

- `parseTxt`：标准「第X章」分章；无章节标记回退按长度切块。
- `prompt.validate`：合法 JSON 通过；缺字段/类型错被拒。
- `extractor.merge`：跨章同名人物去重；别名命中；关系去重；`occur_chapter` 倒叙保留。
- `filter`：给定 upto，graph/timeline 过滤正确（边界 = 当前章）。
- AI 调用用 mock，不打真实网络。

---

## 11. 给执行 agent 的任务分解（按序，每步带完成判据）

- **T1 脚手架**：根 workspaces、server/web 骨架、`.env.example`、`.gitignore`、README 雏形、`npm start/dev/test` 脚本。判据：`npm run dev` 能起空白前端 + 后端健康检查 `/api/health`。
- **T2 DB 层**：`db.js` 按 §4 建表（幂等迁移）。判据：首启自动建库建表。
- **T3 导入解析**：`parseEpub`/`parseTxt` + `POST /books/import` + 书架列表/详情/章节正文接口。判据：导入 txt/epub 后能读正文（AC2 的"可读"部分）。
- **T4 AI 抽取**：`ai/client`、`prompt`、`extractor`，逐章抽取入库 + SSE 进度 + 重抽接口。判据：导入后数据入库、进度推送、AC9。
- **T5 阅读器前端**：Library + Reader + ReaderPane + ImportProgress，进度读写。判据：AC1/AC2。
- **T6 关系图**：`graph` 接口 + GraphView + DossierCard + 揭露动画。判据：AC3/AC4/AC5/AC6。
- **T7 时间线 + 人物一览**：`timeline` 接口 + TimelineView + CharacterList。判据：AC7。
- **T8 打磨与发布**：夜间模式/字号、错误提示、README 完整启动说明、AC9 隐私校验、补齐单测。判据：全部 AC 通过、`npm test` 绿。

---

## 12. 明确的非目标（本期不做）
账号体系、云同步、内置书城、移动端原生、付费、猜凶手/预测玩法（含真凶 culprit 识别）、AI 结果手动微调、本地模型后端（均列入 v2）。

## 13. 待定项（执行前可用默认值，无需阻塞）
- 项目正式名：默认 `mystery-reader`。
- 默认模型：`.env.example` 用 `gpt-4o-mini` 示例，README 另给一个国内兼容接口示例。
