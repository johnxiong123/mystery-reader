import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

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

loadDotEnv();

export function getConfig() {
  const port = Number.parseInt(process.env.PORT || '8787', 10);
  const apiKey = process.env.AI_API_KEY || '';
  const baseURL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const dataDir = process.env.MYSTERY_READER_DATA_DIR || path.join(rootDir, 'data');

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT 必须是有效端口号。');
  }

  return {
    rootDir,
    port,
    ai: { apiKey: apiKey === 'sk-xxxx' ? '' : apiKey, baseURL, model },
    dataDir,
    uploadDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'mystery-reader.sqlite'),
    settingsPath: path.join(dataDir, 'settings.json')
  };
}
