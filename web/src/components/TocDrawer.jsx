import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function TocDrawer({ open, bookId, currentChapter, furthestChapter, bookmarkChapters, onJump, onClose, nightMode }) {
  const [chapters, setChapters] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    api.chapterList(bookId)
      .then((list) => { if (active) { setChapters(list); setError(""); } })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [open, bookId, furthestChapter]);

  if (!open) return null;

  const panelClass = nightMode ? "bg-[#221d16] text-[#ece2cd] border-[#3a2f22]" : "bg-manila text-ink border-line";
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="章节目录">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className={`absolute left-0 top-0 flex h-full w-80 max-w-[85vw] flex-col border-r shadow-xl ${panelClass}`}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "inherit" }}>
          <span className="font-reader text-base font-semibold">章节目录</span>
          <button type="button" onClick={onClose} className="px-2 text-lg leading-none hover:text-noir">×</button>
        </div>
        {error && <div className="px-4 py-2 text-sm text-red-600">{error}</div>}
        <ul className="min-h-0 flex-1 overflow-y-auto py-2">
          {chapters.map((chapter) => {
            const isCurrent = chapter.idx === currentChapter;
            const isRead = chapter.idx <= furthestChapter;
            return (
              <li key={chapter.idx}>
                <button
                  type="button"
                  onClick={() => { onJump(chapter.idx); onClose(); }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-black/5 ${
                    isCurrent ? "font-semibold text-noir" : isRead ? "" : mutedClass
                  }`}
                >
                  <span className="shrink-0">{isCurrent ? "▸" : ""}</span>
                  <span className="truncate">
                    第 {chapter.idx + 1} 章{chapter.title ? ` · ${chapter.title}` : ""}
                  </span>
                  {bookmarkChapters?.has(chapter.idx) && <span className="ml-auto shrink-0">🔖</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
