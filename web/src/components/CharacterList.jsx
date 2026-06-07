export default function CharacterList({ characters, selectedCharacterId, onSelectCharacter, nightMode = false }) {
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  if (characters.length === 0) {
    return (
      <div className={`grid h-full place-items-center p-8 text-center ${nightMode ? "casefile-dark text-[#ece2cd]" : "casefile-bg text-ink"}`}>
        <div>
          <div className="font-reader text-lg font-semibold">暂无可见人物</div>
          <p className={`mt-2 max-w-sm text-sm ${mutedClass}`}>人物首次出现章节必须小于等于当前阅读进度。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full overflow-y-auto p-5 ${nightMode ? "casefile-dark" : "casefile-bg"}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {characters.map((character, index) => {
          const selected = String(selectedCharacterId) === String(character.id);
          const initial = Array.from(character.name || "?")[0];
          const tilt = index % 2 === 0 ? "-rotate-1" : "rotate-1";
          const base = nightMode
            ? "border-[#3a2f22] bg-[#2a2219] text-[#ece2cd]"
            : "border-line bg-card text-ink";
          return (
            <button
              key={character.id}
              type="button"
              onClick={() => onSelectCharacter(character.id)}
              className={`${nightMode ? "aged-d" : "aged"} group relative flex items-center gap-3 rounded-md border p-3 text-left shadow-slip transition hover:-translate-y-0.5 ${tilt} hover:rotate-0 ${
                selected ? "border-noir ring-2 ring-noir/30" : base
              } ${selected && !nightMode ? "bg-card" : ""}`}
            >
              <span className="pin absolute -top-2 left-1/2 -translate-x-1/2" />
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-sm font-reader text-lg font-bold ${
                  nightMode ? "bg-[#1d1812] text-[#d4564a]" : "bg-manila text-noir"
                } border ${nightMode ? "border-[#3a2f22]" : "border-line"}`}
              >
                {initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-reader font-semibold">{character.name}</span>
                <span className={`mt-0.5 block truncate text-sm ${mutedClass}`}>
                  {character.identity || "身份待揭示"}
                </span>
              </span>
              <span className={`shrink-0 self-start text-xs ${mutedClass}`}>第 {character.first_seen_chapter + 1} 章</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
