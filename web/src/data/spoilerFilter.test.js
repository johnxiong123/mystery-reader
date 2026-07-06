import { describe, expect, it } from "vitest";
import {
  clampUpto, computePercent, filterCharacter, filterGraph,
  filterTimeline, maskChapterTitles, searchChapters
} from "./spoilerFilter.js";

const dossier = {
  characters: [
    { id: 1, name: "福尔摩斯", aliases: ["歇洛克"], identity: "侦探", first_seen_chapter: 0 },
    { id: 2, name: "华生", aliases: [], identity: "医生", first_seen_chapter: 1 },
    { id: 3, name: "凶手", aliases: [], identity: null, first_seen_chapter: 2 }
  ],
  relationships: [
    { id: 10, from_char_id: 1, to_char_id: 2, type: "朋友", reveal_chapter: 1, description: "同住" },
    { id: 11, from_char_id: 1, to_char_id: 3, type: "对手", reveal_chapter: 2, description: "追捕" }
  ],
  events: [
    { id: 20, description: "案发", occur_chapter: 0, reveal_chapter: 1, involved: [1, 2] },
    { id: 21, description: "真相", occur_chapter: 0, reveal_chapter: 2, involved: [1, 3] }
  ]
};
const chapters = [
  { idx: 0, title: "开端", content: "福尔摩斯在贝克街。", word_count: 9 },
  { idx: 1, title: "调查", content: "华生记录了案发经过。福尔摩斯沉思。", word_count: 17 },
  { idx: 2, title: "凶手现身", content: "凶手落网，真相大白。", word_count: 10 }
];

describe("spoilerFilter", () => {
  it("clampUpto 夹取范围", () => {
    expect(clampUpto(99, 3)).toBe(2);
    expect(clampUpto(-1, 3)).toBe(0);
    expect(clampUpto(1, 3)).toBe(1);
  });

  it("filterGraph：未出场人物与涉及它的边都不可见", () => {
    const graph = filterGraph(dossier, 1);
    expect(graph.nodes.map((n) => n.id)).toEqual([1, 2]);
    expect(graph.nodes[0].aliases).toEqual(["歇洛克"]);
    expect(graph.edges.map((e) => e.id)).toEqual([10]);
    expect(graph.edges[0]).toMatchObject({ source: 1, target: 2 });
  });

  it("filterCharacter：详情带人名，未揭露返回 null", () => {
    const detail = filterCharacter(dossier, 1, 1);
    expect(detail.relationships).toEqual([
      { id: 10, from_char_id: 1, from: "福尔摩斯", to_char_id: 2, to: "华生", type: "朋友", reveal_chapter: 1, description: "同住" }
    ]);
    expect(detail.events.length).toBe(1);
    expect(detail.events[0].involved).toEqual(["福尔摩斯", "华生"]);
    expect(filterCharacter(dossier, 3, 1)).toBeNull();
  });

  it("filterTimeline 按 reveal 过滤", () => {
    expect(filterTimeline(dossier, 1).map((e) => e.id)).toEqual([20]);
    expect(filterTimeline(dossier, 2).length).toBe(2);
  });

  it("maskChapterTitles 未读章标题为 null", () => {
    expect(maskChapterTitles(chapters, 1)).toEqual([
      { idx: 0, title: "开端" }, { idx: 1, title: "调查" }, { idx: 2, title: null }
    ]);
  });

  it("searchChapters 绝不泄露 upto 之后内容", () => {
    const result = searchChapters(chapters, "凶手", 1);
    expect(result.results).toEqual([]);
    const hit = searchChapters(chapters, "福尔摩斯", 1);
    expect(hit.results.length).toBe(2);
    expect(Math.max(...hit.results.map((r) => r.chapterIdx))).toBe(1);
    expect(hit.results[0].snippet).toContain("福尔摩斯");
    expect(() => searchChapters(chapters, "短", 1)).toThrow();
  });

  it("computePercent 字数加权", () => {
    // (9+17)/36 = 72.2 → 72
    expect(computePercent(chapters, 1)).toBe(72);
    expect(computePercent([], 0)).toBe(0);
  });
});
