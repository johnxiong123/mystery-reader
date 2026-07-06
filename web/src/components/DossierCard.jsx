import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function DossierCard({ bookId, character, currentChapter, onClose, nightMode = false, variant = "panel" }) {
  const [dossier, setDossier] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!character) {
      setDossier(null);
      setError("");
      return () => {
        active = false;
      };
    }
    setDossier(null);
    setError("");
    api
      .character(bookId, character.id, currentChapter)
      .then((data) => {
        if (!active) return;
        setDossier(data);
        setError("");
      })
      .catch((requestError) => {
        if (!active) return;
        setDossier(null);
        setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, [bookId, character?.id, currentChapter]);

  if (!character) {
    return null;
  }

  const shellSafe = nightMode ? "border-[#3a2f22]" : "border-line";
  const muted = nightMode ? "text-[#b6a384]" : "text-steel";
  const slip = nightMode ? "border-[#3a2f22] bg-[#2a2219]" : "border-line bg-manila";
  const accent = nightMode ? "text-[#d4564a]" : "text-noir";

  const layoutClass = variant === "popover"
    ? "w-full max-h-[60vh] overflow-y-auto rounded-md border p-4 shadow-2xl backdrop-blur"
    : "absolute inset-x-3 bottom-3 z-20 max-h-[45vh] w-auto overflow-y-auto rounded-md border p-4 shadow-panel backdrop-blur sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:max-h-[calc(100%-32px)] sm:w-[min(360px,calc(100%-32px))] sm:p-5";

  return (
    <aside
      className={`${layoutClass} ${shellSafe} ${
        nightMode ? "bg-[#241d15]/97 text-[#ece2cd]" : "bg-card/97 text-ink"
      }`}
    >
      <div className={`mb-4 flex items-center justify-between gap-3 border-b pb-3 ${shellSafe}`}>
        <div className="min-w-0">
          <div className={`mb-1 text-[10px] font-bold uppercase tracking-[0.2em] ${muted}`}>个人卷宗 · Dossier</div>
          <div className="truncate font-reader text-xl font-semibold">{dossier?.name || character.name}</div>
          <div className={`mt-0.5 truncate text-sm ${muted}`}>
            {dossier?.identity || character.identity || "身份待揭示"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`shrink-0 rounded-md border px-2 py-1 text-sm transition hover:border-noir hover:text-noir ${slip}`}
        >
          关闭
        </button>
      </div>

      {error && <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <dl className={`grid grid-cols-2 gap-3 rounded-md border p-3 text-sm ${slip}`}>
        <div>
          <dt className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>别名</dt>
          <dd className="mt-1 font-reader">{dossier?.aliases?.length ? dossier.aliases.join("、") : "暂无"}</dd>
        </div>
        <div>
          <dt className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>首次登场</dt>
          <dd className="mt-1 font-reader">第 {(dossier?.first_seen_chapter ?? character.first_seen_chapter) + 1} 章</dd>
        </div>
      </dl>

      <section className="mt-5">
        <h3 className="mb-2 flex items-center gap-2 font-reader text-sm font-semibold">
          <span className={`inline-block h-0.5 w-4 rounded-full ${nightMode ? "bg-[#d4564a]" : "bg-noir"}`} />
          可见关系
        </h3>
        <div className="space-y-2">
          {dossier?.relationships?.length ? (
            dossier.relationships.map((relationship) => (
              <div key={relationship.id} className={`rounded-md border p-3 text-sm ${slip}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`font-reader font-semibold ${accent}`}>{relationship.type}</span>
                  <span className={`text-xs ${muted}`}>第 {relationship.reveal_chapter + 1} 章揭示</span>
                </div>
                <div className={muted}>
                  {relationship.from} <span className={accent}>—</span> {relationship.to}
                </div>
                {relationship.description && <p className="mt-2 font-reader leading-6">{relationship.description}</p>}
              </div>
            ))
          ) : (
            <div className={`rounded-md border p-3 text-sm ${slip} ${muted}`}>暂无已揭露关系。</div>
          )}
        </div>
      </section>

      <section className="mt-5">
        <h3 className="mb-2 flex items-center gap-2 font-reader text-sm font-semibold">
          <span className={`inline-block h-0.5 w-4 rounded-full ${nightMode ? "bg-[#d4564a]" : "bg-noir"}`} />
          可见事件
        </h3>
        <div className="space-y-2">
          {dossier?.events?.length ? (
            dossier.events.map((event) => (
              <div key={event.id} className={`rounded-md border p-3 text-sm ${slip}`}>
                <div className={`mb-1 text-xs ${muted}`}>
                  发生第 {event.occur_chapter + 1} 章 · 揭露第 {event.reveal_chapter + 1} 章
                </div>
                <p className="font-reader leading-6">{event.description}</p>
              </div>
            ))
          ) : (
            <div className={`rounded-md border p-3 text-sm ${slip} ${muted}`}>暂无已揭露事件。</div>
          )}
        </div>
      </section>
    </aside>
  );
}
