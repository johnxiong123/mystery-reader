import { useEffect, useRef } from "react";
import DossierCard from "./DossierCard.jsx";

// anchor: { x, y }（viewport 坐标）；character: 命中的人物节点；miss: 未命中提示文本或 null
export default function SelectionDossier({ bookId, character, miss, anchor, currentChapter, onOpenFull, onClose, nightMode }) {
  const boxRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) onClose();
    }
    if (character || miss) {
      window.addEventListener("pointerdown", handlePointerDown);
      return () => window.removeEventListener("pointerdown", handlePointerDown);
    }
  }, [character, miss, onClose]);

  useEffect(() => {
    if (!miss) return;
    const timer = setTimeout(onClose, 1500);
    return () => clearTimeout(timer);
  }, [miss, onClose]);

  if (!anchor || (!character && !miss)) return null;

  const style = {
    position: "fixed",
    left: Math.min(anchor.x, window.innerWidth - 340),
    top: Math.min(anchor.y + 12, window.innerHeight - 80),
    zIndex: 50
  };

  if (miss) {
    return (
      <div style={style} className={`rounded-md border px-3 py-1.5 text-sm shadow-lg ${
        nightMode ? "border-[#3a2f22] bg-[#2a2219] text-[#b6a384]" : "border-line bg-card text-steel"
      }`}>
        {miss}
      </div>
    );
  }

  return (
    <div ref={boxRef} style={style} className="w-80 max-w-[90vw]">
      <DossierCard
        bookId={bookId}
        character={character}
        currentChapter={currentChapter}
        onClose={onClose}
        nightMode={nightMode}
        variant="popover"
      />
      <button
        type="button"
        onClick={() => { onOpenFull(character.id); onClose(); }}
        className={`mt-1 w-full rounded-md border px-3 py-1.5 text-xs font-semibold shadow ${
          nightMode ? "border-[#3a2f22] bg-[#2a2219] text-[#ece2cd]" : "border-line bg-card text-ink"
        } hover:border-noir hover:text-noir`}
      >
        查看完整卷宗 →
      </button>
    </div>
  );
}
