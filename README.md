# mystery-reader

本地全栈悬疑小说阅读器：导入 txt/epub 后，后端在导入阶段调用 OpenAI 兼容接口抽取人物、关系与事件，阅读阶段只从本地 SQLite 读取并按当前章节服务端防剧透过滤。

## 下载安装

macOS 用户可直接下载 DMG 安装包，无需安装 Node 或任何命令行工具：

👉 **[下载 Mystery Reader (macOS DMG)](https://github.com/johnxiong123/mystery-reader/releases)**

## 功能介绍

| 功能 | 说明 | 截图 |
|------|------|------|
| 📚 **3D 书架** | Coverflow 轮播书架，拖拽/滚轮/方向键浏览，支持搜索 | ![书架](./screenshots/library.png) |
| 🔍 **AI 智能抽取** | 导入 TXT/EPUB 后 AI 逐章抽取人物、关系、事件，实时进度 | ![导入](./screenshots/import.png) |
| 📖 **沉浸阅读** | 左侧正文 + 右侧关系图分栏，字号调节 + 夜间模式 | ![阅读](./screenshots/reader.png) |
| 🔤 **字号调节** | 支持多档字号，一键放大缩小，适配不同阅读习惯 | - |
| 🌙 **夜间模式** | 深色背景 + 暖色文字，夜间护眼阅读 | - |
| 🖥️ **纯阅读模式** | 一键切换纯阅读视图，隐藏右侧面板，专注正文 | ![纯阅读](./screenshots/plain-reader.png) |
| ↔️ **自由分栏** | 中间分隔条可拖拽，自由调整正文与可视化面板的比例 | ![分栏](./screenshots/splitter.png) |
| 🗺️ **人物关系图** | Canvas 2D 力导向图，按阅读进度生长，揭露动画高亮 | ![关系图](./screenshots/graph.png) |
| ⏱️ **事件时间线** | 事件按发生时间排列，倒叙事件特别标注 | ![时间线](./screenshots/timeline.png) |
| 👤 **人物档案卡** | 点击节点查看人物详情、关联关系、参与事件 | ![档案卡](./screenshots/dossier.png) |
| 🔒 **防剧透** | 所有数据服务端按章节过滤，没读到的绝不泄露 | - |

> 💡 截图请放到 `screenshots/` 目录下，替换上面的占位路径即可。

## 使用说明

### 两种使用模式

| 模式 | 有 API Key | 无 API Key |
|------|-----------|-----------|
| 书架浏览 | ✅ | ✅ |
| 阅读正文 | ✅ | ✅ |
| AI 解析人物/关系/事件 | ✅ | ❌ |
| 关系图 / 时间线 / 档案卡 | ✅ | ❌ |

- **完整模式**：配置 API Key 后导入书籍，AI 逐章自动提取人物、关系、事件。阅读时右侧面板显示关系图、时间线和档案卡。
- **纯阅读模式**：不配 API Key 也能用 —— 浏览书架、打开书籍看正文，只是没有 AI 解析和可视化面板。

### 配置 API Key

**方式一：配置文件（适合 `npm start` 用户）**

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 Key：

```bash
AI_API_KEY=sk-your-key-here
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

DeepSeek 用户示例：

```bash
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
```

**方式二：应用内设置（适合 DMG 用户）**

打开应用后，点击右上角「设置」按钮，在弹出的对话框中填写 API Key 和 Base URL，保存即生效。

### 注意事项

- 🔐 API Key **只存本地**，不会上传到任何服务器。前端代码和日志中不会出现 Key。
- 💰 AI 仅在**导入书籍时**调用，阅读阶段零 API 请求，不消耗额外 token。
- 🌐 支持所有兼容 OpenAI SDK 接口的服务商（OpenAI / DeepSeek / Moonshot / 通义千问 等）。

## 启动

```bash
npm install
cp .env.example .env
npm start
```

`.env` 中配置：

```bash
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
PORT=8787
```

API Key 只由后端读取，不应写入前端代码、构建产物或日志。

DeepSeek 兼容配置示例：

```bash
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
```

## 开发

```bash
npm run dev
npm test
```

后端默认监听 `http://localhost:8787`，API 前缀为 `/api`。生产启动会先构建 `web/dist`，再由 Fastify 单端口托管前端静态资源。

## macOS DMG 打包

```bash
npm run package:mac
```

产物输出到 `dist/Mystery-Reader-mac-arm64.dmg`。安装包内会带上当前 Node arm64 运行时、后端、前端构建产物、依赖和 seed 数据库；不会打包 `.env` 或 `data/settings.json`。双击 App 后会启动本地服务并打开浏览器，用户数据保存到 `~/Library/Application Support/Mystery Reader`。

## 真实导入验收

先确认 `.env` 已配置真实 OpenAI 兼容接口。不要把真实 Key 写入前端代码、日志或提交记录。

```bash
npm run smoke:real
```

默认会导入 `fixtures/qa-10chapters.txt`，它是一份原创 10 章验收样本。也可以指定自己的文件：

```bash
npm run smoke:real -- /path/to/book.txt
npm run smoke:real -- /path/to/book.epub
```

脚本会启动后端、上传书籍、监听 SSE 进度，并检查：

- 导入状态完成，章节正文可读取。
- `graph` / `timeline` 按 `upto` 服务端过滤，不下发未揭露人物、关系或事件。
- 时间线按 `occur_chapter` 升序。
- 前端构建产物不包含 `AI_API_KEY` 或密钥形态字符串。

默认验收通过后会停止脚本启动的后端，但保留导入书籍用于界面查看。需要保持服务继续运行时：

```bash
npm run smoke:real -- --keep-server
```

需要验收结束后删除本次导入书籍时：

```bash
npm run smoke:real -- --cleanup
```
