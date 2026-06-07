import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, openImportProgress } from "../api.js";
import AiSettingsDialog from "../components/AiSettingsDialog.jsx";
import ImportProgress from "../components/ImportProgress.jsx";

function formatStatus(status) {
  if (status === "done") return "分析完成";
  if (status === "error") return "导入异常";
  if (status === "extracting") return "分析中";
  if (status === "pending_config") return "待配置 Key";
  return "待解析";
}

function progressPercent(book) {
  if (!book.total_chapters) return 0;
  return Math.round((book.analyzed_chapters / book.total_chapters) * 100);
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6.2" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  );
}

function ShelfIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 5v14" strokeLinecap="round" />
      <path d="M9 6v12" strokeLinecap="round" />
      <path d="M13 4.5v15" strokeLinecap="round" />
      <path d="m17 6 3 12" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 7h8" strokeLinecap="round" />
      <path d="M10 7V5.5h4V7" strokeLinejoin="round" />
      <path d="M9 10v7M15 10v7" strokeLinecap="round" />
      <path d="M6.8 7.5 7.6 20h8.8l.8-12.5" strokeLinejoin="round" />
    </svg>
  );
}

const coverThemes = [
  { spine: "#082b46", cover: "#0f4167", fore: "#f7f1e6" },
  { spine: "#773325", cover: "#9b4432", fore: "#fff3df" },
  { spine: "#1d332b", cover: "#234b3d", fore: "#f5f0e8" },
  { spine: "#2d2525", cover: "#3c3331", fore: "#f7ead7" },
  { spine: "#6b541d", cover: "#937632", fore: "#fff7dc" },
  { spine: "#1d252c", cover: "#303c45", fore: "#f5f7f8" }
];

function themeFor(index) {
  return coverThemes[index % coverThemes.length];
}

// 一次最多渲染到中心两侧各 4 本，避免书很多时 DOM 过大。
const VISIBLE = 4;

export default function Library({ books, loading, error, onRefresh, onOpenBook }) {
  const inputRef = useRef(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const wheelLockRef = useRef(0);
  const positionRef = useRef(0);

  const [activeImport, setActiveImport] = useState(null);
  const [importError, setImportError] = useState("");
  const [aiSettings, setAiSettings] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [deletingBookId, setDeletingBookId] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1200 : window.innerWidth
  );

  positionRef.current = position;

  const loadAiSettings = useCallback(async () => {
    try {
      const nextSettings = await api.aiSettings();
      setAiSettings(nextSettings);
      setSettingsError("");
    } catch (requestError) {
      setSettingsError(requestError.message);
    }
  }, []);

  useEffect(() => {
    loadAiSettings();
  }, [loadAiSettings]);

  async function saveAiSettings(payload) {
    setSettingsSaving(true);
    try {
      const saved = await api.updateAiSettings(payload);
      setAiSettings(saved);
      setSettingsError("");
      return saved;
    } catch (requestError) {
      setSettingsError(requestError.message);
      return null;
    } finally {
      setSettingsSaving(false);
    }
  }

  const startImport = useCallback(
    async (file) => {
      if (!file) return;
      setImportError("");
      const startedAt = Date.now();
      setActiveImport({
        fileName: file.name,
        analyzed: 0,
        total: 0,
        status: "uploading",
        uploadPercent: 0,
        startedAt,
        phaseStartedAt: startedAt
      });

      try {
        const { bookId, status } = await api.importBook(file, {
          onUploadProgress: (percent) => {
            setActiveImport((current) => {
              if (!current) return current;
              const nextStatus = percent >= 100 ? "parsing" : "uploading";
              return {
                ...current,
                status: nextStatus,
                uploadPercent: percent,
                phaseStartedAt: current.status === nextStatus ? current.phaseStartedAt : Date.now()
              };
            });
          }
        });

        setActiveImport((current) => ({
          fileName: file.name,
          analyzed: current?.analyzed || 0,
          total: current?.total || 0,
          status: status || "parsing",
          uploadPercent: 100,
          startedAt: current?.startedAt || startedAt,
          phaseStartedAt: Date.now(),
          bookId
        }));

        let progressClosed = false;
        const source = openImportProgress(bookId, {
          onProgress: (payload) => {
            setActiveImport((current) => {
              const nextStatus = payload.status || "extracting";
              return {
                bookId,
                fileName: file.name,
                analyzed: payload.analyzed,
                total: payload.total,
                status: nextStatus,
                uploadPercent: 100,
                failed: payload.failed || 0,
                startedAt: current?.startedAt || startedAt,
                phaseStartedAt: current?.status === nextStatus ? current.phaseStartedAt : Date.now()
              };
            });
            onRefresh();
            if (payload.status === "done" || payload.status === "error" || payload.status === "pending_config") {
              progressClosed = true;
              source.close();
            }
          },
          onError: () => {
            if (progressClosed) return;
            setImportError("进度连接已断开，可刷新书架查看当前状态。");
          }
        });
      } catch (requestError) {
        setActiveImport((current) =>
          current
            ? {
                ...current,
                status: "error",
                errorMessage: requestError.message,
                phaseStartedAt: Date.now()
              }
            : null
        );
        setImportError(requestError.message);
      }
    },
    [onRefresh]
  );

  const totals = books.reduce(
    (acc, book) => {
      acc.chapters += book.total_chapters || 0;
      acc.done += book.import_status === "done" ? 1 : 0;
      return acc;
    },
    { chapters: 0, done: 0 }
  );

  const filteredBooks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return books.filter((book) => {
      const haystack = `${book.title} ${book.author || ""}`.toLowerCase();
      return keyword ? haystack.includes(keyword) : true;
    });
  }, [books, query]);

  const count = filteredBooks.length;
  const maxIndex = Math.max(count - 1, 0);

  // 每本书中心间距（也是「拖动多少像素移动一本」），随屏幕宽度自适应。
  const spacing = viewportWidth < 560 ? 124 : viewportWidth < 900 ? 156 : 188;

  // 书的数量变化时把当前居中位置夹回有效范围。
  useEffect(() => {
    setPosition((value) => clamp(value, 0, maxIndex));
  }, [maxIndex]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const centerIndex = clamp(Math.round(position), 0, maxIndex);
  const selectedBook = filteredBooks[centerIndex] || null;

  const snapTo = useCallback(
    (target) => {
      setDragging(false);
      setPosition(clamp(target, 0, Math.max(filteredBooks.length - 1, 0)));
    },
    [filteredBooks.length]
  );

  const step = useCallback(
    (delta) => {
      snapTo(Math.round(positionRef.current) + delta);
    },
    [snapTo]
  );

  // 滚轮浏览：用原生非 passive 监听，才能 preventDefault 阻止页面滚动。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      if (filteredBooks.length === 0) return;
      if (Math.abs(event.deltaX) < 8 && Math.abs(event.deltaY) < 8) return;
      event.preventDefault();
      const now = Date.now();
      if (now - wheelLockRef.current < 220) return;
      wheelLockRef.current = now;
      step(event.deltaX + event.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [filteredBooks.length, step]);

  function onPointerDown(event) {
    if (count === 0) return;
    // 不要 setPointerCapture：捕获会让 click 落到容器上，导致书本按钮点不开。
    suppressClickRef.current = false;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startPos: positionRef.current,
      lastX: event.clientX,
      lastT: performance.now(),
      velocity: 0,
      moved: 0
    };
    setDragging(true);
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const dx = event.clientX - drag.startX;
    drag.moved = Math.max(drag.moved, Math.abs(dx));

    const now = performance.now();
    const dt = now - drag.lastT;
    if (dt > 0) {
      const instant = (event.clientX - drag.lastX) / dt; // px/ms
      drag.velocity = drag.velocity * 0.7 + instant * 0.3;
      drag.lastX = event.clientX;
      drag.lastT = now;
    }

    setPosition(clamp(drag.startPos - dx / spacing, 0, maxIndex));
  }

  function endDrag() {
    const drag = dragRef.current;
    if (!drag?.active) return;
    drag.active = false;
    setDragging(false);
    suppressClickRef.current = drag.moved > 6;

    // 甩动惯性：把松手速度投影到「书的格数」上，吸附到最近一本。
    const fling = (drag.velocity / spacing) * 150;
    snapTo(Math.round(positionRef.current - fling));
  }

  function onItemClick(index) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (index === centerIndex) {
      onOpenBook(filteredBooks[index].id);
    } else {
      snapTo(index);
    }
  }

  function onKeyDown(event) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Enter" && selectedBook) {
      onOpenBook(selectedBook.id);
    }
  }

  async function deleteSelectedBook() {
    if (!selectedBook || deletingBookId) return;
    const confirmed = window.confirm(`确定删除《${selectedBook.title}》吗？这会移除本地章节、人物关系和时间线数据。`);
    if (!confirmed) return;

    setImportError("");
    setDeletingBookId(selectedBook.id);
    try {
      await api.deleteBook(selectedBook.id);
      if (activeImport?.bookId === selectedBook.id) setActiveImport(null);
      await onRefresh();
      setPosition((value) => clamp(value, 0, Math.max(filteredBooks.length - 2, 0)));
    } catch (deleteError) {
      setImportError(deleteError.message || "删除失败");
    } finally {
      setDeletingBookId(null);
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#f6f3ec] text-[#3b2630]">
      <header className="flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-4">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-[#5a2b1f] text-white">
            <span className="text-sm font-semibold">MR</span>
          </div>
          <div>
            <div className="text-lg font-semibold">Mystery Reader</div>
            <div className="text-xs text-[#765d57]">100% Local · 数据仅保存在本机</div>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".epub,.txt"
          onChange={(event) => {
            startImport(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-md border border-[#d4bdb0] bg-white/60 px-4 py-2 text-sm font-semibold text-[#5c3c4b] shadow-sm transition hover:border-[#6b2f1e] hover:text-[#6b2f1e]"
          >
            {aiSettings?.configured ? "AI 已配置" : "设置"}
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-[#6b2f1e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#8a3c26]"
          >
            导入书籍
          </button>
        </div>
      </header>

      <main className="relative mx-auto flex min-h-[calc(100vh-56px)] max-w-[1700px] flex-col px-4 pb-6 pt-3">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="mt-3 font-reader text-4xl font-semibold leading-tight tracking-normal text-[#402837] sm:text-5xl md:text-6xl">
            <span className="inline-block">悬疑故事，</span>
            <span className="inline-block">现在可视化。</span>
          </h1>
          <p className="mt-2 font-reader text-xl text-[#5c3c4b] md:text-2xl">
            读一本书，让人物关系随着章节慢慢浮现。
          </p>
        </div>

        {(error || importError) && (
          <div className="mx-auto mt-5 w-full max-w-4xl rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error || importError}
          </div>
        )}

        <section className="relative mt-1 flex flex-1 items-center justify-center overflow-hidden">
          {loading && <div className="text-sm text-[#765d57]">正在读取本地书架...</div>}

          {!loading && (
            <div
              ref={stageRef}
              className={`coverflow ${dragging ? "dragging" : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown}
              tabIndex={0}
              role="listbox"
              aria-label="书架"
            >
              {count === 0 ? (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="cf-empty"
                >
                  <span className="cf-kicker">LOCAL</span>
                  <span className="cf-title">添加一本新书</span>
                  <span className="cf-author">支持 EPUB / TXT</span>
                </button>
              ) : (
                <>
                  {filteredBooks.map((book, index) => {
                    const offset = index - position;
                    const abs = Math.abs(offset);
                    if (abs > VISIBLE + 0.2) return null;

                    const theme = themeFor(index);
                    const translateX = offset * spacing;
                    const rotateY = clamp(-offset * 18, -52, 52);
                    const translateZ = -abs * 90;
                    const scale = Math.max(0.74, 1 - abs * 0.12);
                    const opacity = abs > VISIBLE ? 0 : Math.max(0.2, 1 - abs * 0.22);
                    const zIndex = 200 - Math.round(abs * 10);
                    const detail = Math.max(0, 1 - abs * 1.1);
                    const isCenter = index === centerIndex;

                    return (
                      <button
                        key={book.id}
                        type="button"
                        onClick={() => onItemClick(index)}
                        className={`cf-item ${isCenter ? "cf-center" : ""}`}
                        style={{
                          "--cover": theme.cover,
                          "--spine": theme.spine,
                          "--fore": theme.fore,
                          transform: `translate(-50%, -50%) translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                          opacity,
                          zIndex
                        }}
                        aria-label={isCenter ? `打开 ${book.title}` : `选择 ${book.title}`}
                        aria-selected={isCenter}
                      >
                        <span className="cf-kicker" style={{ opacity: detail }}>
                          {book.source_format || "local"}
                        </span>
                        <span className="cf-title">{book.title}</span>
                        <span className="cf-author" style={{ opacity: detail }}>
                          {book.author || "未知作者"}
                        </span>
                        <span className="cf-meta" style={{ opacity: detail }}>
                          {formatStatus(book.import_status)} · {book.total_chapters || 0}章 · {progressPercent(book)}%
                        </span>
                      </button>
                    );
                  })}
                  {count > 1 && <div className="cf-hint">拖动 · 滚轮 · ← → 浏览，点击居中书打开</div>}
                </>
              )}
            </div>
          )}
        </section>

        <section className="mx-auto mt-2 w-full max-w-3xl border-t border-[#d6c8bd] pt-5">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setShowSearch((value) => !value)}
              className="grid h-12 w-12 place-items-center rounded-full border border-[#d4bdb0] bg-white/60 text-[#6b2f1e] shadow-sm transition hover:bg-white"
              aria-label="搜索"
            >
              <SearchIcon />
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setShowSearch(false);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[#6b2f1e] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#8a3c26]"
            >
              <ShelfIcon />
              All books
            </button>
            {selectedBook && (
              <button
                type="button"
                onClick={deleteSelectedBook}
                disabled={deletingBookId === selectedBook.id}
                className="inline-flex items-center gap-2 rounded-full border border-[#d4bdb0] px-5 py-3 text-sm font-semibold text-[#8a3c35] transition hover:border-[#8a3c35] hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <TrashIcon />
                {deletingBookId === selectedBook.id ? "删除中" : "删除当前"}
              </button>
            )}
          </div>

          {showSearch && (
            <div className="mx-auto mt-5 flex max-w-md gap-2">
              <input
                className="h-11 flex-1 rounded-full border border-[#d4bdb0] bg-white/80 px-5 text-sm outline-none placeholder:text-[#9f8a80] focus:border-[#6b2f1e]"
                placeholder="搜索书名或作者..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                onClick={onRefresh}
                className="h-11 rounded-full border border-[#d4bdb0] bg-white/80 px-5 text-sm font-semibold text-[#5c3c4b]"
              >
                刷新
              </button>
            </div>
          )}

          <div className="mt-5 text-center text-sm text-[#7b665f]">
            {books.length} books · {totals.chapters} chapters · {totals.done} completed
          </div>

          {activeImport && (
            <div className="mx-auto mt-5 w-full max-w-4xl">
              <ImportProgress progress={activeImport} />
            </div>
          )}
        </section>

      </main>
      <AiSettingsDialog
        open={settingsOpen}
        settings={aiSettings}
        saving={settingsSaving}
        error={settingsError}
        onClose={() => setSettingsOpen(false)}
        onSave={saveAiSettings}
      />
    </div>
  );
}
