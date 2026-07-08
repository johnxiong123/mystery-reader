import { useEffect, useRef, useState } from "react";
import { api } from "../data/index.js";

export default function SearchPanel({ open, bookId, furthestChapter, onJump, onClose, nightMode }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setSearched(false);
      setTruncated(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const body = await api.search(bookId, q, furthestChapter);
        setResults(body.results);
        setTruncated(Boolean(body.truncated));
        setSearched(true);
        setError("");
      } catch (requestError) {
        setError(requestError.message);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [open, query, bookId, furthestChapter]);

  if (!open) return null;

  const panelClass = nightMode ? "bg-[#221d16] text-[#ece2cd] border-[#3a2f22]" : "bg-manila text-ink border-line";
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  function highlight(snippet) {
    const q = query.trim();
    const parts = snippet.split(q);
    return parts.flatMap((part, index) =>
      index === 0 ? [part] : [<mark key={index} className="bg-amber-200 text-ink">{q}</mark>, part]
    );
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="全文搜索">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`absolute right-0 top-0 flex h-full w-96 max-w-[90vw] flex-col border-l shadow-xl ${panelClass}`}>
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "inherit" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
            placeholder="搜索已读内容…（至少 2 字）"
            className={`min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none ${
              nightMode ? "border-[#3a2f22] bg-[#2a2219]" : "border-line bg-card"
            }`}
          />
          <button type="button" onClick={onClose} className="px-2 text-lg leading-none hover:text-noir">×</button>
        </div>
        {error && <div className="px-4 py-2 text-sm text-red-600">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {searched && results.length === 0 && (
            <div className={`px-4 py-6 text-sm ${mutedClass}`}>
              在已读范围内（前 {furthestChapter + 1} 章）未找到「{query.trim()}」。未读章节不参与搜索，以防剧透。
            </div>
          )}
          <ul>
            {results.map((result, index) => (
              <li key={`${result.chapterIdx}-${result.matchOffset}-${index}`}>
                <button
                  type="button"
                  onClick={() => { onJump(result.chapterIdx); onClose(); }}
                  className="w-full border-b px-4 py-3 text-left text-sm transition hover:bg-black/5"
                  style={{ borderColor: "inherit" }}
                >
                  <div className={`mb-1 text-xs ${mutedClass}`}>第 {result.chapterIdx + 1} 章{result.title ? ` · ${result.title}` : ""}</div>
                  <div className="leading-relaxed">{highlight(result.snippet)}</div>
                </button>
              </li>
            ))}
          </ul>
          {truncated && <div className={`px-4 py-3 text-xs ${mutedClass}`}>结果过多，仅显示部分匹配。</div>}
        </div>
      </div>
    </div>
  );
}
