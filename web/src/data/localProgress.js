export function createLocalProgress(storage = globalThis.localStorage) {
  const read = (key, fallback) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => storage.setItem(key, JSON.stringify(value));

  const progressKey = (slug) => `mr-pack-progress-${slug}`;
  const bookmarksKey = (slug) => `mr-pack-bookmarks-${slug}`;

  return {
    getProgress(slug) {
      const saved = read(progressKey(slug), null);
      return { current_chapter: saved?.current_chapter ?? 0, furthest_chapter: saved?.furthest_chapter ?? 0 };
    },
    saveProgress(slug, requested, totalChapters) {
      const current = Math.max(0, Math.min(Number(requested) || 0, totalChapters - 1));
      const prev = this.getProgress(slug);
      const next = { current_chapter: current, furthest_chapter: Math.max(prev.furthest_chapter, current) };
      write(progressKey(slug), next);
      return next;
    },
    listBookmarks(slug) {
      return read(bookmarksKey(slug), []);
    },
    addBookmark(slug, { chapter_idx, scroll_pct = 0, note = null }) {
      const list = this.listBookmarks(slug);
      const id = list.reduce((max, b) => Math.max(max, b.id), 0) + 1;
      const bookmark = {
        id,
        chapter_idx: Number(chapter_idx),
        scroll_pct: Math.max(0, Math.min(1, Number(scroll_pct) || 0)),
        note: typeof note === "string" ? note.slice(0, 200) : null,
        created_at: new Date().toISOString()
      };
      write(bookmarksKey(slug), [...list, bookmark].sort((a, b) => a.chapter_idx - b.chapter_idx || a.id - b.id));
      return bookmark;
    },
    deleteBookmark(slug, id) {
      write(bookmarksKey(slug), this.listBookmarks(slug).filter((b) => b.id !== Number(id)));
      return { ok: true };
    }
  };
}
