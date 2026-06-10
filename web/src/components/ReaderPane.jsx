import { useMemo, useState } from "react";

export default function ReaderPane({ book, chapter, currentChapter, progressPercent = 0, onChangeChapter, onOpenToc, onOpenSearch, onOpenBookmarks, articleRef, onTextSelect, nightMode, onNightModeChange }) {
  const [fontSize, setFontSize] = useState(19);

  const paragraphs = useMemo(() => {
    if (!chapter?.content) return [];
    return chapter.content
      .split(/\n{2,}|\r\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }, [chapter]);

  const total = book?.total_chapters || 0;

  const shellClass = nightMode ? "paper-sheet-dark text-[#ece2cd]" : "paper-sheet text-ink";
  const dividerClass = nightMode ? "border-[#3a2f22]" : "border-line";
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";
  const controlClass = nightMode
    ? "border-[#3a2f22] bg-[#2a2219] text-[#ece2cd]"
    : "border-line bg-card text-ink";

  return (
    <section className={`flex min-h-[calc(100vh-56px)] flex-col overflow-hidden lg:h-full lg:min-h-0 ${shellClass}`}>
      <div className={`shrink-0 border-b px-7 py-6 ${dividerClass}`}>
        <div className="mb-3 flex items-center gap-3">
          <span className="stamp font-reader text-[11px] text-noir">第 {currentChapter + 1} 章</span>
          <span className={`text-xs uppercase tracking-[0.18em] ${mutedClass}`}>Case Reading</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-reader text-[1.7rem] font-semibold leading-tight">
            {chapter?.title || "正在载入章节"}
          </h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenToc}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${controlClass} hover:border-noir hover:text-noir`}
            >
              ☰ 目录
            </button>
            <button
              type="button"
              onClick={onOpenSearch}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${controlClass} hover:border-noir hover:text-noir`}
            >
              🔍 搜索
            </button>
            <button
              type="button"
              onClick={onOpenBookmarks}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${controlClass} hover:border-noir hover:text-noir`}
            >
              🔖 书签
            </button>
            <div className={`flex items-center rounded-md border text-sm ${controlClass}`}>
              <button
                type="button"
                onClick={() => setFontSize((value) => Math.max(15, value - 1))}
                className="px-3 py-1.5 hover:text-noir"
              >
                A-
              </button>
              <span className={`min-w-9 border-x px-2 py-1.5 text-center ${dividerClass}`}>{fontSize}</span>
              <button
                type="button"
                onClick={() => setFontSize((value) => Math.min(26, value + 1))}
                className="px-3 py-1.5 hover:text-noir"
              >
                A+
              </button>
            </div>
            <button
              type="button"
              onClick={() => onNightModeChange(!nightMode)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${controlClass} hover:border-noir hover:text-noir`}
            >
              {nightMode ? "☾ 夜读" : "☀ 日读"}
            </button>
          </div>
        </div>
      </div>

      <article
        ref={articleRef}
        onMouseUp={() => {
          if (!onTextSelect) return;
          const selection = window.getSelection();
          const text = selection?.toString() ?? "";
          if (!text.trim()) return;
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          onTextSelect(text, { x: rect.left, y: rect.bottom });
        }}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-10"
      >
        {paragraphs.length === 0 ? (
          <div className={`text-sm ${mutedClass}`}>暂无章节内容。</div>
        ) : (
          <div className={`reader-text ${nightMode ? "aged-d" : "aged"} relative mx-auto max-w-[720px] pb-8 font-reader`} style={{ fontSize }}>
            {paragraphs.map((paragraph, index) => (
              <p
                key={`${index}-${paragraph.slice(0, 12)}`}
                className={
                  index === 0
                    ? "mb-6 [&::first-letter]:float-left [&::first-letter]:mr-2 [&::first-letter]:font-reader [&::first-letter]:text-[3.2em] [&::first-letter]:font-bold [&::first-letter]:leading-[0.82] [&::first-letter]:text-noir"
                    : "mb-6 indent-8"
                }
              >
                {paragraph}
              </p>
            ))}
            <div className={`mt-10 text-center text-xs tracking-[0.3em] ${mutedClass}`}>— 本章完 —</div>
          </div>
        )}
      </article>

      <footer className={`flex shrink-0 items-center gap-3 border-t px-4 py-3 sm:px-8 ${dividerClass} ${nightMode ? "bg-[#221d16]" : "bg-manila"}`}>
        <button
          type="button"
          disabled={currentChapter <= 0}
          onClick={() => onChangeChapter(currentChapter - 1)}
          className={`rounded-md border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${controlClass} enabled:hover:border-noir enabled:hover:text-noir`}
        >
          ‹ 上一章
        </button>
        <div className="flex-1 px-3 text-center">
          <div className={`mb-1.5 text-xs ${mutedClass}`}>
            第 {currentChapter + 1} / {total || "-"} 章 · 全书 {progressPercent}%
          </div>
          <div className={`mx-auto h-1 max-w-72 overflow-hidden rounded-full ${nightMode ? "bg-[#3a2f22]" : "bg-line"}`}>
            <div className="h-1 rounded-full bg-noir transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <button
          type="button"
          disabled={!book || currentChapter >= total - 1}
          onClick={() => onChangeChapter(currentChapter + 1)}
          className={`rounded-md border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${controlClass} enabled:hover:border-noir enabled:hover:text-noir`}
        >
          下一章 ›
        </button>
      </footer>
    </section>
  );
}
