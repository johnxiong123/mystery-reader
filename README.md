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
| 🗺️ **人物关系图** | Canvas 2D 力导向图，按阅读进度生长，揭露动画高亮 | ![关系图](./screenshots/graph.png) |
| ⏱️ **事件时间线** | 事件按发生时间排列，倒叙事件特别标注 | ![时间线](./screenshots/timeline.png) |
| 👤 **人物档案卡** | 点击节点查看人物详情、关联关系、参与事件 | ![档案卡](./screenshots/dossier.png) |
| 🔒 **防剧透** | 所有数据服务端按章节过滤，没读到的绝不泄露 | - |

> 💡 截图请放到 `screenshots/` 目录下，替换上面的占位路径即可。

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
