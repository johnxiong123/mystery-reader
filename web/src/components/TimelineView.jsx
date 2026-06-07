export default function TimelineView({ events, nightMode = false }) {
  const mutedClass = nightMode ? "text-[#b6a384]" : "text-steel";

  if (events.length === 0) {
    return (
      <div className={`grid h-full place-items-center p-8 text-center ${nightMode ? "casefile-dark text-[#ece2cd]" : "casefile-bg text-ink"}`}>
        <div>
          <div className="font-reader text-lg font-semibold">当前进度暂无可见事件</div>
          <p className={`mt-2 max-w-sm text-sm ${mutedClass}`}>事件按揭露章节过滤，并按实际发生章节排序。</p>
        </div>
      </div>
    );
  }

  const cardClass = nightMode
    ? "border-[#3a2f22] bg-[#2a2219] text-[#ece2cd]"
    : "border-line bg-card text-ink";
  const curl = nightMode ? "aged-d" : "aged";

  return (
    <div className={`h-full overflow-y-auto px-7 py-7 ${nightMode ? "casefile-dark" : "casefile-bg"}`}>
      <div className="relative pl-7">
        {/* 红线主干 */}
        <span className="redstring absolute left-[7px] top-1 bottom-1 w-[3px] rounded-full opacity-80" />
        {events.map((event) => {
          const flashback = event.occur_chapter < event.reveal_chapter;
          return (
            <article key={event.id} className={`${curl} relative mb-6 rounded-md border p-4 shadow-slip ${cardClass}`}>
              {/* 图钉 */}
              <span className="pin absolute -left-[26px] top-4" />
              <div className={`mb-2 flex flex-wrap items-center gap-2 text-xs ${mutedClass}`}>
                <span className="rounded-sm bg-noir/10 px-2 py-0.5 font-semibold text-noir">
                  发生 · 第 {event.occur_chapter + 1} 章
                </span>
                <span>揭露 · 第 {event.reveal_chapter + 1} 章</span>
                {flashback && (
                  <span className="stamp text-[10px] text-ember">倒叙</span>
                )}
              </div>
              <p className="font-reader text-sm leading-7">{event.description}</p>
              {event.involved?.length > 0 && (
                <div className={`mt-3 text-xs ${mutedClass}`}>相关人物：{event.involved.join("、")}</div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
