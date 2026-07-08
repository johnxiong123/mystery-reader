import { describe, expect, it } from "vitest";
import { createPackDataSource } from "./PackDataSource.js";
import { createLocalProgress } from "./localProgress.js";

const files = {
  "index.json": [{ slug: "demo", title: "示例", author: "某某", total_chapters: 2, total_words: 26 }],
  "demo/manifest.json": { packVersion: 1, slug: "demo", title: "示例", author: "某某", lang: "en", total_chapters: 2, total_words: 26 },
  "demo/chapters.json": [
    { idx: 0, title: "开端", content: "福尔摩斯在贝克街等待。", word_count: 11 },
    { idx: 1, title: "凶手现身", content: "凶手终于现身并落网。", word_count: 10 }
  ],
  "demo/dossier.json": {
    characters: [
      { id: 1, name: "福尔摩斯", aliases: [], identity: "侦探", first_seen_chapter: 0 },
      { id: 2, name: "凶手", aliases: [], identity: null, first_seen_chapter: 1 }
    ],
    relationships: [{ id: 10, from_char_id: 1, to_char_id: 2, type: "对手", reveal_chapter: 1, description: "追捕" }],
    events: []
  }
};

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

function makeSource() {
  return createPackDataSource({
    fetchJson: async (path) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return structuredClone(files[path]);
    },
    progressStore: createLocalProgress(memoryStorage())
  });
}

describe("PackDataSource", () => {
  it("books/book 形状与 api 模式兼容", async () => {
    const src = makeSource();
    const books = await src.books();
    expect(books[0]).toMatchObject({ id: "demo", title: "示例", import_status: "done", total_chapters: 2 });
    const book = await src.book("demo");
    expect(book).toMatchObject({ id: "demo", current_chapter: 0, furthest_chapter: 0, analyzed_chapters: 2 });
  });

  it("防剧透链路：graph/chapterList/search 都尊重 upto", async () => {
    const src = makeSource();
    expect((await src.graph("demo", 0)).nodes.length).toBe(1);
    const list = await src.chapterList("demo"); // furthest=0
    expect(list[1].title).toBeNull();
    const found = await src.search("demo", "凶手", 0);
    expect(found.results).toEqual([]);
  });

  it("进度更新带 percent，furthest 不回退", async () => {
    const src = makeSource();
    const up = await src.updateProgress("demo", 1);
    expect(up).toMatchObject({ current_chapter: 1, furthest_chapter: 1 });
    expect(up.percent).toBe(100);
    const back = await src.updateProgress("demo", 0);
    expect(back).toMatchObject({ current_chapter: 0, furthest_chapter: 1, percent: 100 });
  });

  it("book/chapter 未命中抛错；写操作不可用", async () => {
    const src = makeSource();
    await expect(src.chapter("demo", 99)).rejects.toThrow("章节不存在");
    await expect(src.character("demo", 2, 0)).rejects.toThrow("尚未揭露");
    expect(() => src.importBook()).toThrow("静态版不支持");
    expect(src.capabilities.canImport).toBe(false);
    expect(await src.aiSettings()).toEqual({ configured: false });
  });
});
