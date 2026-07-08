import { createProducerAi } from './ai.js';
import { runSplit } from './pipeline/split.js';
import { runGlossary } from './pipeline/glossary.js';
import { runTranslate } from './pipeline/translate.js';
import { runExtract } from './pipeline/extract.js';
import { runQa } from './pipeline/qa.js';
import { runPack } from './pipeline/pack.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const next = rest[i + 1];
      if (next != null && !next.startsWith('--')) { flags[key] = next; i += 1; }
      else flags[key] = true;
    }
  }
  return { command, flags };
}

const { command, flags } = parseArgs(process.argv.slice(2));
const slug = flags.book;
const allow = flags.allow ? String(flags.allow).split(',').map((s) => s.trim()).filter(Boolean) : [];

try {
  if (command === 'split') {
    const meta = runSplit({ slug, srcPath: flags.src, lang: flags.lang, title: flags.title, author: flags.author });
    if (flags.pd) {
      const { loadArtifact, saveArtifact } = await import('./paths.js');
      saveArtifact(slug, 'meta', { ...loadArtifact(slug, 'meta'), public_domain_basis: flags.pd });
    }
    console.log(`分章完成：${meta.total_chapters} 章`);
  } else if (command === 'glossary') {
    const glossary = await runGlossary({ slug, ai: createProducerAi(), force: Boolean(flags.force) });
    console.log(`术语表 ${glossary.entries.length} 条（work/${slug}/glossary.json 可人工修改译名后再翻译）`);
  } else if (command === 'translate') {
    const chapters = await runTranslate({ slug, ai: createProducerAi(), from: flags.from != null ? Number(flags.from) : null });
    console.log(`翻译完成：${chapters.length} 章`);
  } else if (command === 'extract') {
    const dossier = await runExtract({ slug, ai: createProducerAi() });
    console.log(`抽取完成：人物 ${dossier.characters.length} / 关系 ${dossier.relationships.length} / 事件 ${dossier.events.length}`);
  } else if (command === 'qa') {
    const result = runQa({ slug, allow });
    if (result.ok) console.log('QA 通过 ✅');
    else {
      console.error(`QA ${result.violations.length} 项未过：`);
      for (const v of result.violations) console.error(`  [${v.rule}] ${v.detail}`);
      process.exit(1);
    }
  } else if (command === 'pack') {
    const manifest = runPack({ slug, allow });
    console.log(`出包完成：packs/${manifest.slug}（${manifest.total_chapters} 章 / ${manifest.total_words} 字）`);
  } else {
    console.error('用法: cli.js <split|glossary|translate|extract|qa|pack> --book <slug> [flags]');
    process.exit(1);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
