import { useEffect, useMemo, useState } from "react";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getProgressModel(progress, now) {
  const status = progress.status || "uploading";
  const startedAt = progress.startedAt || now;
  const phaseStartedAt = progress.phaseStartedAt || startedAt;
  const elapsed = now - startedAt;
  const phaseElapsedSeconds = Math.floor(Math.max(0, now - phaseStartedAt) / 1000);
  const uploadPercent = clamp(Number(progress.uploadPercent) || 0, 0, 100);
  const chapterPercent = progress.total ? clamp((progress.analyzed / progress.total) * 100, 0, 100) : 0;

  if (status === "done") {
    return {
      percent: 100,
      stage: "归档完成",
      detail: "人物、关系和事件已写入本地案卷。",
      elapsed
    };
  }

  if (status === "error") {
    const percent = progress.total ? 42 + Math.round(chapterPercent * 0.55) : Math.max(12, Math.round(uploadPercent * 0.18));
    return {
      percent: clamp(percent, 12, 98),
      stage: "导入异常",
      detail: progress.errorMessage || "AI 抽取未完成，请检查后端日志或模型配置。",
      elapsed
    };
  }

  if (status === "pending_config") {
    return {
      percent: 40,
      stage: "识别章节完成",
      detail: "已导入，可阅读；配置 API Key 后解析人物关系。",
      elapsed
    };
  }

  if (status === "uploading") {
    return {
      percent: clamp(Math.round(uploadPercent * 0.18), 3, 18),
      stage: "上传文件",
      detail: uploadPercent ? `已上传 ${uploadPercent}%` : "正在把文件交给本地解析器。",
      elapsed
    };
  }

  if (status === "parsing") {
    const percent = progress.total ? 40 : clamp(20 + phaseElapsedSeconds * 2, 20, 38);
    return {
      percent,
      stage: progress.total ? "等待 AI 抽取" : "识别章节",
      detail: progress.total
        ? `已切出 ${progress.total} 章，正在准备逐章分析。`
        : "正在切分章节，章节标题不明显时会按语义段落辅助拆分。",
      elapsed
    };
  }

  const percent = progress.total
    ? 42 + Math.round(chapterPercent * 0.55)
    : clamp(42 + phaseElapsedSeconds, 42, 54);
  return {
    percent: clamp(percent, 42, 97),
    stage: "AI 抽取",
    detail: progress.total
      ? `已分析 ${progress.analyzed || 0} / ${progress.total} 章`
      : "正在识别人物、关系与事件。",
    elapsed
  };
}

export default function ImportProgress({ progress }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (progress.status === "done" || progress.status === "error") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress.status]);

  const model = useMemo(() => getProgressModel(progress, now), [now, progress]);
  const percent = Math.round(model.percent);
  const failed = progress.failed || 0;
  const helpText =
    progress.status === "error" && failed
      ? `${failed} 章抽取失败，请检查后端日志或模型配置后重抽。`
      : model.detail;
  const stages = [
    { id: "uploading", label: "上传文件" },
    { id: "parsing", label: "识别章节" },
    { id: "extracting", label: "AI 抽取" }
  ];
  const activeIndex =
    progress.status === "done"
      ? 3
      : progress.status === "pending_config"
        ? 2
      : progress.status === "error"
        ? progress.total > 0
          ? 2
          : progress.uploadPercent >= 100
            ? 1
            : 0
      : progress.status === "extracting"
        ? 2
        : progress.status === "parsing"
          ? 1
          : 0;

  return (
    <section className="aged relative rounded-md border border-[#d8c8a8] bg-[#fbf6ea] p-4 shadow-slip sm:p-5">
      <span className="tape -top-3 left-8 -rotate-2" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="pin shrink-0" />
          <div className="min-w-0">
            <h2 className="font-reader text-lg font-semibold text-[#3b2f23]">案卷归档中</h2>
            <div className="truncate text-xs text-[#8a7763]">{progress.fileName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-ember">{model.stage}</div>
          <div className="text-xs text-[#8a7763]">已用时 {formatElapsed(model.elapsed)}</div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex justify-between gap-3 text-sm text-[#5c4a36]">
          <span>{helpText}</span>
          <span className="font-semibold">{percent}%</span>
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-full bg-[#e3d4b4]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="导入解析进度"
        >
          <div className="h-2.5 rounded-full bg-noir transition-all duration-500" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {stages.map((stage, index) => {
          const done = activeIndex > index;
          const active = activeIndex === index && progress.status !== "done" && progress.status !== "error";
          const failedStage = activeIndex === index && progress.status === "error";
          const waitingForKey = activeIndex === index && progress.status === "pending_config";
          return (
            <div
              key={stage.id}
              className={`rounded-md border px-3 py-2 text-xs ${
                failedStage
                  ? "border-red-200 bg-red-50 text-red-700"
                  : waitingForKey
                    ? "border-dashed border-[#b89b8c] bg-white/50 text-[#8a7763]"
                  : done
                  ? "border-[#6b2f1e] bg-[#6b2f1e] text-white"
                  : active
                    ? "border-[#b89b8c] bg-white/70 text-[#6b2f1e]"
                    : "border-[#e0d2c5] bg-white/35 text-[#8a7763]"
              }`}
            >
              <div className="font-semibold">{stage.label}</div>
              <div className="mt-0.5">
                {failedStage ? "失败" : waitingForKey ? "待配置" : done ? "已完成" : active ? "进行中" : "等待中"}
              </div>
            </div>
          );
        })}
      </div>

      {progress.total > 0 && (
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-[#8a7763]">
          <span>章节：{progress.analyzed || 0} / {progress.total}</span>
          {failed > 0 && <span className="text-ember">失败：{failed} 章</span>}
        </div>
      )}
    </section>
  );
}
