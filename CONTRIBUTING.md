# 参与开发

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
