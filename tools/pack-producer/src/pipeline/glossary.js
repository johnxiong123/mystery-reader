import { loadArtifact, saveArtifact } from '../paths.js';

const LANG_NAMES = { en: '英语', ja: '日语', fr: '法语' };

export async function runGlossary({ slug, ai, force = false }) {
  const existing = loadArtifact(slug, 'glossary');
  if (existing && !force) return existing;

  const meta = loadArtifact(slug, 'meta');
  const chapters = loadArtifact(slug, 'chapters.src');
  if (!meta || !chapters) throw new Error('请先执行 split 步骤。');

  // 阶段一：逐章采词
  const counts = new Map(); // term -> { type, count }
  for (const chapter of chapters) {
    const result = await ai.chatJson([
      {
        role: 'system',
        content: [
          `你是专有名词采集器。输入是一段${LANG_NAMES[meta.lang]}小说正文。`,
          '抽取其中的专有名词：人名(person)、地名(place)、机构名(org)、其他专名(other)。',
          '只输出 JSON：{"terms":[{"term":"原文专名","type":"person|place|org|other"}]}',
          '同一专名只出现一次；不要输出普通名词。'
        ].join('\n')
      },
      { role: 'user', content: chapter.content }
    ]);
    for (const item of result.terms || []) {
      if (!item?.term) continue;
      const key = item.term.trim();
      const entry = counts.get(key) || { type: item.type || 'other', count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }

  // 阶段二：统一译名（一次调用，保证全书唯一）
  const termList = [...counts.entries()].map(([term, { type }]) => ({ term, type }));
  const translated = await ai.chatJson([
    {
      role: 'system',
      content: [
        `你是文学翻译的译名规范师。给出${LANG_NAMES[meta.lang]}专名的标准中文译名。`,
        '规则：1) 已有通行译名的必须用通行译名（如 Sherlock Holmes→夏洛克·福尔摩斯）；',
        '2) 人名音译使用新华社译名风格；3) 同一专名只给一个译名。',
        '只输出 JSON：{"entries":[{"term":"原文","zh":"中文译名","type":"原样返回"}]}'
      ].join('\n')
    },
    { role: 'user', content: JSON.stringify({ book: meta.title, terms: termList }) }
  ]);

  const zhByTerm = new Map((translated.entries || []).map((e) => [e.term, e]));
  const glossary = {
    lang: meta.lang,
    entries: termList.map(({ term, type }) => ({
      term,
      zh: zhByTerm.get(term)?.zh || term,
      type: zhByTerm.get(term)?.type || type,
      count: counts.get(term).count
    }))
  };
  saveArtifact(slug, 'glossary', glossary);
  return glossary;
}
