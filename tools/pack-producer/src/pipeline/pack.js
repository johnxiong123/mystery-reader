import fs from 'node:fs';
import path from 'node:path';
import { loadArtifact, packDir, packsRoot, readJson, writeJson } from '../paths.js';
import { runQa } from './qa.js';

export function runPack({ slug, allow = [] }) {
  const qa = runQa({ slug, allow });
  if (!qa.ok) {
    const detail = qa.violations.slice(0, 10).map((v) => `[${v.rule}] ${v.detail}`).join('\n');
    throw new Error(`QA 未通过（${qa.violations.length} 项），阻断出包：\n${detail}`);
  }

  const meta = loadArtifact(slug, 'meta');
  const chapters = loadArtifact(slug, 'chapters.zh');
  const dossier = loadArtifact(slug, 'dossier');
  const glossary = loadArtifact(slug, 'glossary');
  const totalWords = chapters.reduce((sum, c) => sum + c.word_count, 0);

  const manifest = {
    packVersion: 1,
    slug,
    title: meta.title,
    author: meta.author,
    lang: meta.lang,
    translator: 'AI 翻译',
    public_domain_basis: meta.public_domain_basis || null,
    total_chapters: meta.total_chapters,
    total_words: totalWords,
    created_at: new Date().toISOString()
  };
  const dir = packDir(slug);
  writeJson(path.join(dir, 'manifest.json'), manifest);
  writeJson(path.join(dir, 'chapters.json'), chapters);
  writeJson(path.join(dir, 'dossier.json'), { characters: dossier.characters, relationships: dossier.relationships, events: dossier.events });
  writeJson(path.join(dir, 'glossary.json'), glossary);
  rebuildIndex();
  return manifest;
}

export function rebuildIndex() {
  const root = packsRoot();
  const entries = [];
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const manifest = readJson(path.join(root, name, 'manifest.json'));
      if (manifest) {
        entries.push({ slug: manifest.slug, title: manifest.title, author: manifest.author, total_chapters: manifest.total_chapters, total_words: manifest.total_words });
      }
    }
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  writeJson(path.join(root, 'index.json'), entries);
  return entries;
}
