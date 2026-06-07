const DEFAULT_TARGET_CHARS = 7000;
const DEFAULT_MAX_CHARS = 10000;
const MIN_HEADING_SCORE = 8;
const HAN_NUM = '一二三四五六七八九十百千万零〇两壹贰叁肆伍陆柒捌玖拾';

const NOISE_RE = /(www\.|https?:\/\/|小说网|手机阅读|请收藏|最新网址|本书来自|下载地址|加入书签|推荐票|月票)/i;
const SENTENCE_PUNCT_RE = /[。！？!?；;，,]/g;

const HEADING_PATTERNS = [
  {
    source: 'chapter',
    score: 9,
    re: new RegExp(`^第[${HAN_NUM}0-9０-９]+[章节回部卷幕集](?:[\\s　:：、.．\\-—_].{0,50})?$`, 'i')
  },
  {
    source: 'volume',
    score: 8,
    re: new RegExp(`^(?:卷[${HAN_NUM}0-9０-９]+|[上中下]卷)(?:[\\s　:：、.．\\-—_].{0,50})?$`, 'i')
  },
  {
    source: 'special',
    score: 9,
    re: new RegExp(`^(?:楔子|序章|引子|前言|序幕|尾声|后记|终章|番外(?:篇|章|[${HAN_NUM}0-9０-９]+)?)(?:[\\s　:：、.．\\-—_].{0,50})?$`, 'i')
  },
  {
    source: 'english',
    score: 8,
    re: /^chapter\s+\d{1,4}(?:[\s:：.．\-—_].{0,50})?$/i
  },
  {
    source: 'cn-index',
    score: 7,
    re: new RegExp(`^[${HAN_NUM}]{1,4}[、.．]\\s*\\S.{0,40}$`)
  },
  {
    source: 'num-index',
    score: 7,
    re: /^(?:\d{1,4}|[０-９]{1,4})(?:[、.．]|\s+)\s*\S.{0,40}$/
  },
  {
    source: 'num-alone',
    score: 7,
    re: /^(?:\d{1,4}|[０-９]{1,4})$/
  }
];

export function detectTxtChapters(input, options = {}) {
  const content = normalizeContent(input);
  const lines = toLines(content);
  const tocHeadings = detectByToc(lines);
  if (tocHeadings.length >= 2) {
    return buildResult('toc', content, tocHeadings);
  }

  const headings = detectHeadingLines(lines);
  if (headings.length >= 2) {
    return buildResult('headings', content, headings);
  }

  return {
    strategy: 'fallback',
    chapters: splitFallback(content, options),
    diagnostics: {
      headingCandidates: headings.length,
      chars: content.length
    }
  };
}

export function decodeTxtBuffer(buffer) {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('gb18030').decode(buffer);
}

function normalizeContent(input) {
  return String(input || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => !NOISE_RE.test(line.trim()))
    .join('\n')
    .trim();
}

function toLines(content) {
  const rawLines = content.split('\n');
  let offset = 0;
  return rawLines.map((text, index) => {
    const start = offset;
    const end = start + text.length;
    const nextStart = index === rawLines.length - 1 ? end : end + 1;
    offset = nextStart;
    return {
      index,
      text,
      trimmed: text.trim(),
      start,
      end,
      nextStart
    };
  });
}

function detectByToc(lines) {
  const scanLimit = Math.min(lines.length, 240);
  const markerIndex = lines.slice(0, scanLimit).findIndex((line) => /^(目录|目\s*录|contents)$/i.test(line.trimmed));
  if (markerIndex === -1) return [];

  const tocCandidates = [];
  for (let i = markerIndex + 1; i < scanLimit; i += 1) {
    const scored = scoreHeadingLine(lines[i], lines);
    if (scored && scored.score >= MIN_HEADING_SCORE) {
      tocCandidates.push(scored);
      continue;
    }
    if (!lines[i].trimmed) continue;
    if (tocCandidates.length >= 2) break;
  }
  if (tocCandidates.length < 3) return [];

  const lastTocLine = tocCandidates[tocCandidates.length - 1].line.index;
  const actualHeadings = [];
  for (const candidate of tocCandidates) {
    const match = lines.find((line) => (
      line.index > lastTocLine &&
      line.trimmed === candidate.line.trimmed
    ));
    if (match) {
      actualHeadings.push({
        ...candidate,
        line: match,
        source: 'toc'
      });
    }
  }

  return dedupeHeadings(actualHeadings);
}

function detectHeadingLines(lines) {
  const candidates = lines
    .map((line) => scoreHeadingLine(line, lines))
    .filter((candidate) => candidate && candidate.score >= MIN_HEADING_SCORE);

  return dedupeHeadings(candidates);
}

function scoreHeadingLine(line, lines) {
  const text = line.trimmed;
  if (!text || text.length > 64 || NOISE_RE.test(text)) return null;

  const pattern = HEADING_PATTERNS.find((item) => item.re.test(text));
  if (!pattern) return null;

  let score = pattern.score;
  if (text.length <= 30) score += 1;
  if (text.length <= 14) score += 1;
  if (isBlank(lines[line.index - 1])) score += 1;
  if (isBlank(lines[line.index + 1])) score += 1;
  if (line.index === 0) score += 1;

  const punctCount = (text.match(SENTENCE_PUNCT_RE) || []).length;
  if (punctCount >= 2) score -= 4;
  if (/[。！？!?；;]$/.test(text)) score -= 3;
  if (text.length > 42) score -= 2;

  return {
    line,
    title: text,
    source: pattern.source,
    score
  };
}

function buildResult(strategy, content, headings) {
  const chapters = headings.map((heading, index) => {
    const next = headings[index + 1];
    const contentStart = heading.line.nextStart;
    const contentEnd = next ? next.line.start : content.length;
    const body = content.slice(contentStart, contentEnd).trim();
    return {
      title: heading.title,
      content: body,
      source: strategy === 'toc' ? 'toc' : heading.source,
      score: heading.score,
      startOffset: heading.line.start,
      endOffset: contentEnd,
      charCount: body.length
    };
  }).filter((chapter) => chapter.content.length > 0);

  return {
    strategy,
    chapters,
    diagnostics: {
      headingCandidates: headings.length,
      chars: content.length
    }
  };
}

function splitFallback(content, options) {
  const target = options.fallbackTargetChars || DEFAULT_TARGET_CHARS;
  const max = options.fallbackMaxChars || DEFAULT_MAX_CHARS;
  const paragraphs = content.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length > max ? splitLongParagraph(paragraph, max) : [paragraph];
    for (const piece of pieces) {
      const next = current ? `${current}\n\n${piece}` : piece;
      if (current && (next.length > max || current.length >= target)) {
        chunks.push(current.trim());
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.map((chunk, index) => ({
    title: `第 ${index + 1} 段`,
    content: chunk,
    source: 'fallback',
    score: 0,
    startOffset: null,
    endOffset: null,
    charCount: chunk.length
  }));
}

function splitLongParagraph(paragraph, max) {
  const sentences = paragraph.match(/[^。！？!?]+[。！？!?]?/g) || [paragraph];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    const next = current + sentence;
    if (current && next.length > max) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function dedupeHeadings(candidates) {
  const seenOffsets = new Set();
  return candidates
    .filter((candidate) => {
      if (seenOffsets.has(candidate.line.start)) return false;
      seenOffsets.add(candidate.line.start);
      return true;
    })
    .sort((a, b) => a.line.start - b.line.start);
}

function isBlank(line) {
  return !line || !line.trimmed;
}
