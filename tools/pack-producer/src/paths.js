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
