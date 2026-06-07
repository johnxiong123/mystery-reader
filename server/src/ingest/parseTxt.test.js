import { describe, expect, it } from 'vitest';
import { parseTxt } from './parseTxt.js';

describe('parseTxt', () => {
  it('按中文章节标题分章', () => {
    const parsed = parseTxt(Buffer.from('第1章 开端\n第一章正文\n\n第二章 转折\n第二章正文'), 'demo.txt');

    expect(parsed.title).toBe('demo');
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]).toMatchObject({ title: '第1章 开端', content: '第一章正文' });
    expect(parsed.chapters[1]).toMatchObject({ title: '第二章 转折', content: '第二章正文' });
  });

  it('无章节标记时按长度回退切块', () => {
    const parsed = parseTxt(Buffer.from('段落一\n\n段落二'), 'plain.txt');

    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].title).toBe('第 1 段');
  });

  it('正式导入时使用增强章节检测器识别非标准标题', () => {
    const parsed = parseTxt(Buffer.from([
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
    ].join('\n')), 'loose.txt');

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      '楔子',
      '一、雨夜来信',
      '001',
      '尾声'
    ]);
  });
});
