import { describe, expect, it } from "vitest";
import { createLocalProgress } from "./localProgress.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

describe("localProgress", () => {
  it("进度双指针：回看不回退 furthest，current 夹取", () => {
    const store = createLocalProgress(memoryStorage());
    expect(store.getProgress("demo")).toEqual({ current_chapter: 0, furthest_chapter: 0 });
    store.saveProgress("demo", 5, 10);
    store.saveProgress("demo", 2, 10);
    expect(store.getProgress("demo")).toEqual({ current_chapter: 2, furthest_chapter: 5 });
    store.saveProgress("demo", 99, 10);
    expect(store.getProgress("demo").current_chapter).toBe(9);
  });

  it("书签增删查，跨书隔离", () => {
    const store = createLocalProgress(memoryStorage());
    const created = store.addBookmark("a", { chapter_idx: 1, scroll_pct: 0.5, note: "伏笔" });
    expect(created).toMatchObject({ id: 1, chapter_idx: 1, scroll_pct: 0.5, note: "伏笔" });
    expect(store.listBookmarks("a").length).toBe(1);
    expect(store.listBookmarks("b")).toEqual([]);
    store.deleteBookmark("a", created.id);
    expect(store.listBookmarks("a")).toEqual([]);
  });
});
