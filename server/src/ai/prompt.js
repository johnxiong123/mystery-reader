export function buildExtractionMessages({ chapterIdx, content, knownCharacters }) {
  const known = knownCharacters.map((char) => ({
    name: char.name,
    aliases: safeJsonArray(char.aliases)
  }));

  return [
    {
      role: 'system',
      content: [
        '你是中文小说信息抽取器，只输出 JSON，不输出解释。',
        '任务：基于「本章正文」抽取本章新出现/新揭露的人物、关系、事件。',
        '去重：给出「已知人物」，同一人用其既有规范名，不要重复创建；新人物才新增。',
        '章节标记规则：人物 first_seen_chapter = 当前章号。',
        '关系/事件 reveal_chapter = 当前章号，即本章读者才知道。',
        '事件 occur_chapter = 事件实际发生的章号；若本章揭露过去发生的事，填真实发生章号，否则等于当前章号。',
        'JSON 结构必须包含 characters、relationships、events 三个数组。',
        '字段名必须严格使用下面示例，不要改成 source/target/relation/detail 等替代字段名。',
        '示例 JSON：',
        JSON.stringify({
          characters: [
            { name: '人物姓名', aliases: ['别名'], identity: '读者当前已知身份' }
          ],
          relationships: [
            { from: '来源人物姓名', to: '目标人物姓名', type: '关系类型', description: '本章可见证据描述' }
          ],
          events: [
            { description: '事件描述', occur_chapter: chapterIdx, involved: ['相关人物姓名'] }
          ]
        })
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        current_chapter: chapterIdx,
        known_characters: known,
        chapter_content: content
      })
    }
  ];
}

export function validateExtractionJson(value, currentChapter) {
  const data = typeof value === 'string' ? parseJson(value) : value;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('AI 输出必须是 JSON object。');
  }

  const characters = ensureArray(data.characters, 'characters').map((item, idx) => ({
    name: requiredString(item?.name, `characters[${idx}].name`),
    aliases: optionalStringArray(item?.aliases, `characters[${idx}].aliases`),
    identity: optionalString(item?.identity)
  }));

  const relationships = ensureArray(data.relationships, 'relationships').map((item, idx) => ({
    from: requiredString(firstValue(item, ['from', 'source', 'source_name', 'sourceName', 'from_name']), `relationships[${idx}].from`),
    to: requiredString(firstValue(item, ['to', 'target', 'target_name', 'targetName', 'to_name']), `relationships[${idx}].to`),
    type: requiredString(firstValue(item, ['type', 'relation', 'relationship', 'relationship_type']), `relationships[${idx}].type`),
    description: requiredString(firstValue(item, ['description', 'detail', 'evidence', 'summary']), `relationships[${idx}].description`)
  }));

  const events = ensureArray(data.events, 'events').map((item, idx) => ({
    description: requiredString(firstValue(item, ['description', 'event', 'summary', 'content']), `events[${idx}].description`),
    occur_chapter: integerOrDefault(item?.occur_chapter, currentChapter, `events[${idx}].occur_chapter`),
    involved: optionalStringArray(firstValue(item, ['involved', 'characters', 'participants']), `events[${idx}].involved`)
  }));

  return {
    characters,
    relationships,
    events
  };
}

function parseJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function ensureArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组。`);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串。`);
  return value.trim();
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalStringArray(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} 必须是字符串数组。`);
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function integerOrDefault(value, fallback, name) {
  if (value == null) return fallback;
  if (typeof value === 'string' && value.trim() && Number.isInteger(Number(value))) {
    return Number(value);
  }
  if (!Number.isInteger(value)) throw new Error(`${name} 必须是整数。`);
  return value;
}

function firstValue(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (source[key] != null) return source[key];
  }
  return undefined;
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
