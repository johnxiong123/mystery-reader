import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import CharacterList from "../components/CharacterList.jsx";
import DossierCard from "../components/DossierCard.jsx";
import GraphView from "../components/GraphView.jsx";
import AiSettingsDialog from "../components/AiSettingsDialog.jsx";
import ReaderPane from "../components/ReaderPane.jsx";
import TimelineView from "../components/TimelineView.jsx";
import {
  READER_SPLIT_DEFAULT,
  READER_SPLIT_MAX,
  READER_SPLIT_MIN,
  clampReaderSplit
} from "../readerLayout.js";

const tabs = [
  { id: "graph", label: "线索板" },
  { id: "timeline", label: "时间线" },
  { id: "characters", label: "人物卷宗" }
];

export default function Reader({ bookId, onBack, nightMode, onNightModeChange }) {
  const mainRef = useRef(null);
  const articleRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const [book, setBook] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [timeline, setTimeline] = useState([]);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [furthestChapter, setFurthestChapter] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [activeTab, setActiveTab] = useState("graph");
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [readerSplit, setReaderSplit] = useState(READER_SPLIT_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  const loadBook = useCallback(async () => {
    const nextBook = await api.book(bookId);
    setBook(nextBook);
    setFurthestChapter(nextBook.furthest_chapter || 0);
    setCurrentChapter(nextBook.furthest_chapter || 0);
  }, [bookId]);

  useEffect(() => {
    setLoading(true);
    loadBook()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [loadBook]);

  useEffect(() => {
    api.progress(bookId).then((p) => {
      setProgressPercent(p.percent ?? 0);
      setFurthestChapter(p.furthest_chapter ?? 0);
    }).catch(() => {});
  }, [bookId]);

  const loadAiSettings = useCallback(async () => {
    try {
      const nextSettings = await api.aiSettings();
      setAiSettings(nextSettings);
      setSettingsError("");
    } catch (requestError) {
      setSettingsError(requestError.message);
    }
  }, []);

  useEffect(() => { loadAiSettings(); }, [loadAiSettings]);

  async function saveAiSettings(payload) {
    setSettingsSaving(true);
    try {
      const saved = await api.updateAiSettings(payload);
      setAiSettings(saved);
      setSettingsError("");
      if (saved.configured && isPendingConfig) {
        setAiSettingsOpen(false);
        handleReExtract();
      }
      return saved;
    } catch (requestError) {
      setSettingsError(requestError.message);
      return null;
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleReExtract() {
    try {
      await api.reExtractBook(bookId);
      await loadBook();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const loadChapterContext = useCallback(
    async (chapterIdx) => {
      if (!book) return;
      try {
        setError("");
        const [nextChapter, nextGraph, nextTimeline] = await Promise.all([
          api.chapter(bookId, chapterIdx),
          api.graph(bookId, chapterIdx),
          api.timeline(bookId, chapterIdx)
        ]);
        setChapter(nextChapter);
        setGraph({
          nodes: Array.isArray(nextGraph?.nodes) ? nextGraph.nodes : [],
          edges: Array.isArray(nextGraph?.edges) ? nextGraph.edges : []
        });
        setTimeline(nextTimeline);
      } catch (requestError) {
        setError(requestError.message);
      }
    },
    [book, bookId]
  );

  useEffect(() => {
    loadChapterContext(currentChapter);
  }, [currentChapter, loadChapterContext]);

  useEffect(() => {
    if (
      selectedCharacterId &&
      graph.nodes.length > 0 &&
      !graph.nodes.some((node) => String(node.id) === String(selectedCharacterId))
    ) {
      setSelectedCharacterId(null);
    }
  }, [graph.nodes, selectedCharacterId]);

  const changeChapter = async (nextIdx) => {
    if (!book) return;
    const bounded = Math.max(0, Math.min(nextIdx, book.total_chapters - 1));
    const saved = await api.updateProgress(bookId, bounded);
    setCurrentChapter(saved.current_chapter);
    setFurthestChapter(saved.furthest_chapter);
    setProgressPercent(saved.percent ?? 0);
    setBook((prev) => (prev ? { ...prev, current_chapter: saved.current_chapter, furthest_chapter: saved.furthest_chapter } : prev));
    if (pendingScrollRef.current == null && articleRef.current) articleRef.current.scrollTop = 0;
  };

  const selectedCharacter = useMemo(
    () => graph.nodes.find((node) => String(node.id) === String(selectedCharacterId)),
    [graph.nodes, selectedCharacterId]
  );

  function toggleSidePanel() {
    setSidePanelOpen((open) => {
      if (open) setSelectedCharacterId(null);
      return !open;
    });
  }

  const resizeReaderPanelsByClientX = useCallback((clientX) => {
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const next = ((clientX - rect.left) / rect.width) * 100;
    setReaderSplit(clampReaderSplit(next));
  }, []);

  const resizeReaderPanels = useCallback(
    (event) => {
      resizeReaderPanelsByClientX(event.clientX);
    },
    [resizeReaderPanelsByClientX]
  );

  useEffect(() => {
    if (!resizing) return;

    const handlePointerMove = (event) => resizeReaderPanelsByClientX(event.clientX);
    const handleMouseMove = (event) => resizeReaderPanelsByClientX(event.clientX);
    const stopResizing = () => setResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resizeReaderPanelsByClientX, resizing]);

  function startPanelResize(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
    }
    setResizing(true);
    resizeReaderPanels(event);
  }

  function endPanelResize(event) {
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
    }
    setResizing(false);
  }

  function handlePanelResizeKey(event) {
    const step = event.shiftKey ? 8 : 2;
    let next = null;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = readerSplit - step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = readerSplit + step;
    } else if (event.key === "Home") {
      next = READER_SPLIT_MIN;
    } else if (event.key === "End") {
      next = READER_SPLIT_MAX;
    }

    if (next === null) return;
    event.preventDefault();
    setReaderSplit(clampReaderSplit(next));
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center casefile-bg text-sm text-steel lg:h-screen lg:overflow-hidden">正在翻开案卷...</div>;
  }

  const panelDark = nightMode;
  const tabBorder = panelDark ? "border-[#3a2f22]" : "border-line";
  const isPendingConfig = book?.import_status === "pending_config";
  const isError = book?.import_status === "error";

  function graphEmptyContent() {
    if (isPendingConfig) {
      return (
        <>
          <p className="mb-3">本书已完成章节导入。配置 API Key 后即可解析人物关系与事件。</p>
          <button
            type="button"
            onClick={() => setAiSettingsOpen(true)}
            className="rounded-md bg-[#6b2f1e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#8a3c26]"
          >
            🔑 配置 API Key 开始解析
          </button>
        </>
      );
    }
    if (isError) {
      return (
        <>
          <p className="mb-3">部分章节解析失败。配置 API Key 后可重新解析。</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAiSettingsOpen(true)}
              className="rounded-md border border-[#d4bdb0] bg-white/60 px-4 py-2 text-sm font-semibold text-[#5c3c4b] transition hover:border-[#6b2f1e]"
            >
              ⚙ 检查 Key 配置
            </button>
            <button
              type="button"
              onClick={handleReExtract}
              className="rounded-md bg-[#6b2f1e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#8a3c26]"
            >
              🔄 重新解析
            </button>
          </div>
        </>
      );
    }
    return <p>AI 可能仍在分析，或这些人物关系尚未在当前阅读进度揭露。</p>;
  }

  return (
    <div className={`flex min-h-screen flex-col lg:h-screen lg:overflow-hidden ${panelDark ? "casefile-dark text-[#ece2cd]" : "casefile-bg text-ink"}`}>
      <header className={`flex h-14 shrink-0 items-center justify-between border-b px-5 ${tabBorder} ${panelDark ? "bg-[#221d16]" : "bg-manila"}`}>
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition hover:border-noir hover:text-noir ${
              panelDark ? "border-[#3a2f22] bg-[#2a2219]" : "border-line bg-card"
            }`}
          >
            ‹ 案卷库
          </button>
          <div className="min-w-0">
            <div className="truncate font-reader text-base font-semibold">{book?.title || "Mystery Reader"}</div>
            <div className={`text-xs ${panelDark ? "text-[#b6a384]" : "text-steel"}`}>
              CASE No.{String(book?.id ?? 0).padStart(3, "0")} · 已读至第 {currentChapter + 1} 章
            </div>
          </div>
        </div>
        <div className={`flex items-center gap-3 text-xs ${panelDark ? "text-[#b6a384]" : "text-steel"}`}>
          <span className="stamp hidden text-[10px] text-noir sm:inline-flex">机密</span>
          {sidePanelOpen && <span className="hidden sm:inline">右侧仅显示当前进度已揭露线索</span>}
          <button
            type="button"
            onClick={toggleSidePanel}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition hover:border-noir hover:text-noir ${
              panelDark ? "border-[#3a2f22] bg-[#2a2219] text-[#ece2cd]" : "border-line bg-card text-ink"
            }`}
          >
            {sidePanelOpen ? "全屏阅读" : "显示线索板"}
          </button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 border-b border-red-300 bg-red-50 px-5 py-2 text-sm text-red-700">{error}</div>
      )}

      <main
        ref={mainRef}
        className={`reader-workspace min-h-0 flex-1 ${sidePanelOpen ? "reader-workspace-open" : "reader-workspace-closed"} ${resizing ? "reader-workspace-resizing" : ""}`}
        style={{ "--reader-left": `${readerSplit}%` }}
      >
        <ReaderPane
          book={book}
          chapter={chapter}
          currentChapter={currentChapter}
          progressPercent={progressPercent}
          onChangeChapter={changeChapter}
          nightMode={nightMode}
          onNightModeChange={onNightModeChange}
        />

        {sidePanelOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整阅读区和线索板宽度"
              aria-valuemin={READER_SPLIT_MIN}
              aria-valuemax={READER_SPLIT_MAX}
              aria-valuenow={readerSplit}
              aria-valuetext={`阅读区宽度 ${readerSplit}%`}
              tabIndex={0}
              onPointerDown={startPanelResize}
              onPointerUp={endPanelResize}
              onPointerCancel={endPanelResize}
              onMouseDown={startPanelResize}
              onMouseUp={endPanelResize}
              onKeyDown={handlePanelResizeKey}
              onDoubleClick={() => setReaderSplit(READER_SPLIT_DEFAULT)}
              className={`reader-resizer hidden lg:flex ${panelDark ? "reader-resizer-dark" : ""}`}
            >
              <span />
            </div>

            <section
              className={`grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-t lg:h-full lg:border-l-0 lg:border-t-0 ${tabBorder} ${
                panelDark ? "bg-[#1d1812]" : "bg-manila"
              }`}
            >
              <div className={`flex gap-1 border-b px-3 pt-2 ${tabBorder}`}>
                {tabs.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`folder-tab px-4 py-2.5 text-sm font-semibold transition ${
                        active
                          ? panelDark
                            ? "bg-[#2a2219] text-[#ece2cd] shadow-[0_-2px_0_#a3302a_inset]"
                            : "bg-card text-noir shadow-[0_-2px_0_#a3302a_inset]"
                          : panelDark
                            ? "text-[#b6a384] hover:text-[#ece2cd]"
                            : "text-steel hover:text-ink"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="relative h-full min-h-0">
                <div className="h-full min-h-0">
                  {activeTab === "graph" && (
                    <GraphView
                      graph={graph}
                      currentChapter={currentChapter}
                      selectedCharacterId={selectedCharacterId}
                      onSelectCharacter={setSelectedCharacterId}
                      nightMode={nightMode}
                      emptyDescription={graphEmptyContent()}
                    />
                  )}
                  {activeTab === "timeline" && <TimelineView events={timeline} nightMode={nightMode} />}
                  {activeTab === "characters" && (
                    <CharacterList
                      characters={graph.nodes}
                      selectedCharacterId={selectedCharacterId}
                      onSelectCharacter={setSelectedCharacterId}
                      nightMode={nightMode}
                    />
                  )}
                </div>

                <DossierCard
                  bookId={bookId}
                  character={selectedCharacter}
                  currentChapter={currentChapter}
                  onClose={() => setSelectedCharacterId(null)}
                  nightMode={nightMode}
                />
              </div>
            </section>
          </>
        )}
      </main>

      <AiSettingsDialog
        open={aiSettingsOpen}
        settings={aiSettings}
        saving={settingsSaving}
        error={settingsError}
        onClose={() => setAiSettingsOpen(false)}
        onSave={saveAiSettings}
      />
    </div>
  );
}
