import { describe, expect, it } from 'vitest';
import { detectTxtChapters } from './chapterDetector.js';

describe('detectTxtChapters', () => {
  it('识别小说常见的非标准章节标题', () => {
    const text = [
      '楔子',
      '雨落在旧楼的铁门上。',
      '',
      '一、雨夜来信',
      '林砚收到一封匿名信。',
      '',
      '001',
      '周屿提前离开酒吧。',
      '',
      '尾声',
      '案卷被重新封存。'
    ].join('\n');

    const result = detectTxtChapters(text);

    expect(result.strategy).toBe('headings');
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      '楔子',
      '一、雨夜来信',
      '001',
      '尾声'
    ]);
  });

  it('用目录标题反查正文位置', () => {
    const text = [
      '目录',
      '第一章 雨夜来信',
      '第二章 酒吧老板',
      '第三章 白塔重逢',
      '',
      '正文开始',
      '',
      '第一章 雨夜来信',
      '林砚在雾城警署收到匿名信。',
      '',
      '第二章 酒吧老板',
      '周屿说自己整晚都在盘账。',
      '',
      '第三章 白塔重逢',
      '陆远在白塔旧楼出现。'
    ].join('\n');

    const result = detectTxtChapters(text);

    expect(result.strategy).toBe('toc');
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0]).toMatchObject({
      title: '第一章 雨夜来信',
      source: 'toc'
    });
    expect(result.chapters[0].content).toContain('林砚在雾城警署收到匿名信。');
    expect(result.chapters[0].content).not.toContain('目录');
  });

  it('无章节标题时按段落和长度兜底切块', () => {
    const paragraph = '林砚沿着港口仓库走了一圈，发现墙缝里有半本被雨水泡皱的账册。';
    const text = Array.from({ length: 30 }, (_, idx) => `${paragraph}${idx}`).join('\n\n');

    const result = detectTxtChapters(text, { fallbackTargetChars: 320, fallbackMaxChars: 520 });

    expect(result.strategy).toBe('fallback');
    expect(result.chapters.length).toBeGreaterThan(1);
    expect(result.chapters.every((chapter) => chapter.source === 'fallback')).toBe(true);
    expect(result.chapters[0].content).toContain('账册。0');
  });
});
