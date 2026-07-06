export default function BookmarkPanel({ open, bookmarks, onAdd, onJump, onDelete, onClose, nightMode }) {
  if (!open) return null;
  const panelClass = nightMode ? "bg-[#221d16] text-[#ece2cd] border-[#3a2f22]" : "bg-manila text-ink border-line";
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="书签列表">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`absolute right-0 top-0 flex h-full w-96 max-w-[90vw] flex-col border-l shadow-xl ${panelClass}`}>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "inherit" }}>
          <span className="font-reader text-base font-semibold">书签</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAdd}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                nightMode ? "border-[#3a2f22] bg-[#2a2219]" : "border-line bg-card"
              } hover:border-noir hover:text-noir`}
            >
              ＋ 在此处加书签
            </button>
            <button type="button" onClick={onClose} className="px-2 text-lg leading-none hover:text-noir">×</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {bookmarks.length === 0 && <div className={`px-4 py-6 text-sm ${mutedClass}`}>还没有书签。阅读时点工具栏「🔖 书签」即可标记当前位置。</div>}
          <ul>
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id} className="flex items-stretch border-b" style={{ borderColor: "inherit" }}>
                <button
                  type="button"
                  onClick={() => { onJump(bookmark); onClose(); }}
                  className="min-w-0 flex-1 px-4 py-3 text-left text-sm transition hover:bg-black/5"
                >
                  <div className={`mb-1 text-xs ${mutedClass}`}>
                    第 {bookmark.chapter_idx + 1} 章 · {new Date(bookmark.created_at).toLocaleString()}
                  </div>
                  <div className="truncate">{bookmark.note || "（无备注）"}</div>
                </button>
                <button
                  type="button"
                  aria-label="删除书签"
                  onClick={() => onDelete(bookmark.id)}
                  className={`px-3 text-sm ${mutedClass} hover:text-red-600`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
