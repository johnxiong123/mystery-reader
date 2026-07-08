import {
  clampUpto, computePercent, filterCharacter, filterGraph,
  filterTimeline, maskChapterTitles, searchChapters
} from "./spoilerFilter.js";
import { createLocalProgress } from "./localProgress.js";

export function createPackDataSource({ fetchJson, progressStore } = {}) {
  const load = fetchJson || (async (path) => {
    const response = await fetch(`${import.meta.env.BASE_URL}packs/${path}`);
    if (!response.ok) throw new Error("卷宗包加载失败。");
    return response.json();
  });
  const progressStoreRef = progressStore || createLocalProgress();
  const cache = new Map();

  async function pack(slug) {
    if (!cache.has(slug)) {
      cache.set(slug, Promise.all([
        load(`${slug}/manifest.json`),
        load(`${slug}/chapters.json`),
        load(`${slug}/dossier.json`)
      ]).then(([manifest, chapters, dossier]) => ({ manifest, chapters, dossier })));
    }
    return cache.get(slug);
  }

  function unsupported() {
    throw new Error("静态版不支持该操作。");
  }

  return {
    capabilities: { canImport: false, canManageBooks: false, canConfigureAi: false },
    health: async () => ({ ok: true }),
    aiSettings: async () => ({ configured: false }),
    updateAiSettings: unsupported,
    importBook: unsupported,
    deleteBook: unsupported,
    reExtractChapter: unsupported,
    reExtractBook: unsupported,

    async books() {
      const index = await load("index.json");
      return index.map((item) => ({
        id: item.slug, title: item.title, author: item.author,
        total_chapters: item.total_chapters, import_status: "done", analyzed_chapters: item.total_chapters,
        source_format: "pack"
      }));
    },

    async book(id) {
      const { manifest } = await pack(id);
      const saved = progressStoreRef.getProgress(id);
      return {
        ...manifest, id,
        import_status: "done", analyzed_chapters: manifest.total_chapters,
        current_chapter: saved.current_chapter, furthest_chapter: saved.furthest_chapter
      };
    },

    async chapter(id, idx) {
      const { chapters } = await pack(id);
      const chapter = chapters.find((c) => c.idx === Number(idx));
      if (!chapter) throw new Error("章节不存在。");
      return { idx: chapter.idx, title: chapter.title, content: chapter.content };
    },

    async chapterList(id) {
      const { chapters } = await pack(id);
      const saved = progressStoreRef.getProgress(id);
      return maskChapterTitles(chapters, saved.furthest_chapter);
    },

    async graph(id, upto) {
      const { manifest, dossier } = await pack(id);
      return filterGraph(dossier, clampUpto(upto, manifest.total_chapters));
    },

    async character(id, charId, upto) {
      const { manifest, dossier } = await pack(id);
      const detail = filterCharacter(dossier, charId, clampUpto(upto, manifest.total_chapters));
      if (!detail) throw new Error("人物不存在或尚未揭露。");
      return detail;
    },

    async timeline(id, upto) {
      const { manifest, dossier } = await pack(id);
      return filterTimeline(dossier, clampUpto(upto, manifest.total_chapters));
    },

    async progress(id) {
      const { chapters } = await pack(id);
      const saved = progressStoreRef.getProgress(id);
      return { ...saved, percent: computePercent(chapters, saved.furthest_chapter) };
    },

    async updateProgress(id, current) {
      const { manifest, chapters } = await pack(id);
      const saved = progressStoreRef.saveProgress(id, current, manifest.total_chapters);
      return { ...saved, percent: computePercent(chapters, saved.furthest_chapter) };
    },

    async search(id, q, upto) {
      const { manifest, chapters } = await pack(id);
      return searchChapters(chapters, q, clampUpto(upto, manifest.total_chapters));
    },

    bookmarks: async (id) => progressStoreRef.listBookmarks(id),
    addBookmark: async (id, payload) => progressStoreRef.addBookmark(id, payload),
    deleteBookmark: async (id, bookmarkId) => progressStoreRef.deleteBookmark(id, bookmarkId)
  };
}
