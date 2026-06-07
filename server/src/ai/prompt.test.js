import { describe, expect, it } from 'vitest';
import { buildExtractionMessages, validateExtractionJson } from './prompt.js';

describe('validateExtractionJson', () => {
  it('接受合法 JSON 并补默认 occur_chapter', () => {
    const result = validateExtractionJson({
      characters: [{ name: '石神哲哉', aliases: ['石神'], identity: '高中数学老师' }],
      relationships: [{ from: '石神哲哉', to: '靖子', type: '邻居', description: '住隔壁' }],
      events: [{ description: '石神帮靖子处理尸体', involved: ['石神哲哉', '靖子'] }]
    }, 2);

    expect(result.events[0].occur_chapter).toBe(2);
  });

  it('拒绝缺必填字段的关系', () => {
    expect(() => validateExtractionJson({
      characters: [],
      relationships: [{ from: 'A', to: 'B', type: '邻居' }],
      events: []
    }, 1)).toThrow(/description/);
  });

  it('兼容常见关系字段别名', () => {
    const result = validateExtractionJson({
      characters: [],
      relationships: [{
        source: '林砚',
        target: '周屿',
        relation: '威胁',
        detail: '林砚收到周屿留下的警告纸条'
      }],
      events: [{ event: '林砚收到匿名信', characters: ['林砚'], occur_chapter: '3' }]
    }, 3);

    expect(result.relationships[0]).toEqual({
      from: '林砚',
      to: '周屿',
      type: '威胁',
      description: '林砚收到周屿留下的警告纸条'
    });
    expect(result.events[0].description).toBe('林砚收到匿名信');
    expect(result.events[0].occur_chapter).toBe(3);
  });

  it('prompt 包含目标 JSON 字段示例', () => {
    const messages = buildExtractionMessages({
      chapterIdx: 0,
      content: '第一章正文',
      knownCharacters: []
    });

    expect(messages[0].content).toContain('"relationships"');
    expect(messages[0].content).toContain('"from"');
    expect(messages[0].content).toContain('"to"');
    expect(messages[0].content).toContain('"occur_chapter"');
  });
});
