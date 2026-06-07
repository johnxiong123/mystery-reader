import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const defaultFixture = path.join(rootDir, 'fixtures/qa-10chapters.txt');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const fileArg = args.find((arg) => !arg.startsWith('--')) || defaultFixture;

if (flags.has('--help') || flags.has('-h')) {
  console.log([
    'Usage: npm run smoke:real -- [book.txt|book.epub] [--keep-server] [--cleanup]',
    '',
    'Requires a real .env with AI_API_KEY / AI_BASE_URL / AI_MODEL.',
    'Does not print secret values. Imported book remains in local SQLite unless --cleanup is set.'
  ].join('\n'));
  process.exit(0);
}

loadDotEnv();

const config = {
  port: Number.parseInt(process.env.PORT || '8787', 10),
  apiKey: process.env.AI_API_KEY || '',
  baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.AI_MODEL || 'gpt-4o-mini',
  timeoutMs: Number.parseInt(process.env.SMOKE_TIMEOUT_MS || String(15 * 60 * 1000), 10)
};

if (!config.apiKey || config.apiKey === 'sk-xxxx') {
  fail('缺少真实 AI_API_KEY。请先复制 .env.example 为 .env，并填入你的 OpenAI 兼容接口配置。');
}

const bookPath = path.resolve(rootDir, fileArg);
if (!fs.existsSync(bookPath)) fail(`找不到导入文件：${bookPath}`);
if (!['.txt', '.epub'].includes(path.extname(bookPath).toLowerCase())) {
  fail('仅支持 .txt 或 .epub 文件。');
}

const appBase = `http://localhost:${config.port}`;
let serverProcess = null;
let startedHere = false;
let importedBookId = null;

try {
  if (!(await healthOk(appBase))) {
    startedHere = true;
    serverProcess = startServer();
    await waitForHealth(appBase, 30_000);
  }

  importedBookId = await importBook(appBase, bookPath);
  console.log(`bookId=${importedBookId}`);
  await waitForImport(appBase, importedBookId, config.timeoutMs);
  await verifyApiContracts(appBase, importedBookId);
  await verifyPrivacy();

  if (flags.has('--cleanup')) {
    cleanupBook(importedBookId);
    console.log('cleanup=done');
  }

  console.log('smoke=passed');
  console.log(`open=${appBase}`);
} finally {
  if (serverProcess && !flags.has('--keep-server')) {
    serverProcess.kill('SIGTERM');
  }
}

function loadDotEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function startServer() {
  console.log('server=start');
  const child = spawn('npm', ['run', 'start', '-w', 'server'], {
    cwd: rootDir,
    env: { ...process.env, OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => process.stdout.write(redact(chunk.toString())));
  child.stderr.on('data', (chunk) => process.stderr.write(redact(chunk.toString())));
  return child;
}

async function healthOk(baseUrl) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/api/health`, 1_500);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (serverProcess?.exitCode != null) fail(`后端启动失败，exitCode=${serverProcess.exitCode}`);
    if (await healthOk(baseUrl)) {
      console.log('server=ready');
      return;
    }
    await delay(500);
  }
  fail('后端启动超时。');
}

async function importBook(baseUrl, sourcePath) {
  const data = fs.readFileSync(sourcePath);
  const form = new FormData();
  form.append('file', new Blob([data]), path.basename(sourcePath));

  const response = await fetch(`${baseUrl}/api/books/import`, {
    method: 'POST',
    body: form
  });
  const payload = await readJson(response);
  if (!response.ok) fail(`导入失败：${payload?.error?.message || response.status}`);
  if (!Number.isInteger(payload.bookId)) fail('导入接口未返回 bookId。');
  return payload.bookId;
}

async function waitForImport(baseUrl, bookId, timeoutMs) {
  const response = await fetch(`${baseUrl}/api/books/${bookId}/import-progress`);
  if (!response.ok || !response.body) fail(`SSE 连接失败：HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data: '));
      if (!line) continue;
      const progress = JSON.parse(line.slice(6));
      console.log(`progress=${progress.analyzed}/${progress.total}:${progress.status}`);
      if (progress.status === 'done') return;
      if (progress.status === 'error') fail('导入抽取状态为 error。');
    }
  }

  fail('等待导入完成超时。');
}

async function verifyApiContracts(baseUrl, bookId) {
  const book = await getJson(`${baseUrl}/api/books/${bookId}`);
  assert(book.import_status === 'done', 'book.import_status 应为 done');
  assert(book.total_chapters >= 1, 'total_chapters 应大于 0');

  const firstChapter = await getJson(`${baseUrl}/api/books/${bookId}/chapters/0`);
  assert(firstChapter.content && firstChapter.idx === 0, '第 1 章正文接口异常');

  await putJson(`${baseUrl}/api/books/${bookId}/progress`, { current_chapter: 0 });
  const earlyGraph = await getJson(`${baseUrl}/api/books/${bookId}/graph?upto=0`);
  const earlyTimeline = await getJson(`${baseUrl}/api/books/${bookId}/timeline?upto=0`);
  assertGraphInvariant(earlyGraph, 0);
  assertTimelineInvariant(earlyTimeline, 0);

  const mid = Math.min(3, book.total_chapters - 1);
  await putJson(`${baseUrl}/api/books/${bookId}/progress`, { current_chapter: mid });
  const midGraph = await getJson(`${baseUrl}/api/books/${bookId}/graph?upto=${mid}`);
  const midTimeline = await getJson(`${baseUrl}/api/books/${bookId}/timeline?upto=${mid}`);
  assertGraphInvariant(midGraph, mid);
  assertTimelineInvariant(midTimeline, mid);
  assert(midGraph.nodes.length > 0, '中段图谱没有任何人物，AI 抽取可能未生效');
  assert(midTimeline.length > 0, '中段时间线没有任何事件，AI 抽取可能未生效');

  await putJson(`${baseUrl}/api/books/${bookId}/progress`, {
    current_chapter: book.total_chapters - 1
  });
  const finalGraph = await getJson(`${baseUrl}/api/books/${bookId}/graph?upto=${book.total_chapters - 1}`);
  const finalTimeline = await getJson(`${baseUrl}/api/books/${bookId}/timeline?upto=${book.total_chapters - 1}`);
  assertGraphInvariant(finalGraph, book.total_chapters - 1);
  assertTimelineInvariant(finalTimeline, book.total_chapters - 1);

  const dbSummary = inspectDb(bookId);
  assert(dbSummary.errorChapters === 0, `存在抽取失败章节：${dbSummary.errorChapters}`);
  assert(dbSummary.characters > 0, '数据库中没有人物');
  assert(dbSummary.events > 0, '数据库中没有事件');
  console.log(`db=characters:${dbSummary.characters},relationships:${dbSummary.relationships},events:${dbSummary.events}`);
}

async function verifyPrivacy() {
  const distDir = path.join(rootDir, 'web/dist');
  if (!fs.existsSync(distDir)) return;
  const files = listFiles(distDir);
  const secret = process.env.AI_API_KEY || '';
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (secret && text.includes(secret)) fail(`前端构建产物包含 AI Key：${file}`);
    if (text.includes('AI_API_KEY') || /sk-[A-Za-z0-9_-]{8,}/.test(text)) {
      fail(`前端构建产物疑似包含密钥标记：${file}`);
    }
  }
  console.log('privacy=passed');
}

function inspectDb(bookId) {
  const db = new Database(path.join(rootDir, 'data/mystery-reader.sqlite'));
  try {
    return {
      errorChapters: db.prepare('SELECT COUNT(*) AS count FROM chapters WHERE book_id = ? AND extract_status = ?').get(bookId, 'error').count,
      characters: db.prepare('SELECT COUNT(*) AS count FROM characters WHERE book_id = ?').get(bookId).count,
      relationships: db.prepare('SELECT COUNT(*) AS count FROM relationships WHERE book_id = ?').get(bookId).count,
      events: db.prepare('SELECT COUNT(*) AS count FROM events WHERE book_id = ?').get(bookId).count
    };
  } finally {
    db.close();
  }
}

function cleanupBook(bookId) {
  const db = new Database(path.join(rootDir, 'data/mystery-reader.sqlite'));
  const tx = db.transaction(() => {
    for (const table of ['reading_progress', 'events', 'relationships', 'characters', 'chapters']) {
      db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(bookId);
    }
    db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
  });
  try {
    tx();
  } finally {
    db.close();
  }
}

function assertGraphInvariant(graph, upto) {
  assert(Array.isArray(graph.nodes), 'graph.nodes 必须是数组');
  assert(Array.isArray(graph.edges), 'graph.edges 必须是数组');
  for (const node of graph.nodes) {
    assert(node.first_seen_chapter <= upto, `graph 泄露未登场人物：${node.name}`);
  }
  for (const edge of graph.edges) {
    assert(edge.reveal_chapter <= upto, `graph 泄露未揭示关系：${edge.type}`);
    assert(graph.nodes.some((node) => node.id === edge.source), 'edge.source 不在可见 nodes 中');
    assert(graph.nodes.some((node) => node.id === edge.target), 'edge.target 不在可见 nodes 中');
  }
}

function assertTimelineInvariant(events, upto) {
  assert(Array.isArray(events), 'timeline 必须是数组');
  let previousOccur = -Infinity;
  for (const event of events) {
    assert(event.reveal_chapter <= upto, `timeline 泄露未揭示事件：${event.description}`);
    assert(event.occur_chapter >= previousOccur, 'timeline 未按 occur_chapter 升序');
    previousOccur = event.occur_chapter;
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await readJson(response);
  if (!response.ok) fail(`${url} -> ${payload?.error?.message || response.status}`);
  return payload;
}

async function putJson(url, body) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await readJson(response);
  if (!response.ok) fail(`${url} -> ${payload?.error?.message || response.status}`);
  return payload;
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function redact(value) {
  const secret = process.env.AI_API_KEY || '';
  return secret ? value.split(secret).join('[REDACTED]') : value;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`smoke=failed ${message}`);
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
