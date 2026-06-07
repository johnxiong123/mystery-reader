import { useEffect, useState } from "react";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export default function AiSettingsDialog({ open, settings, saving, error, onClose, onSave }) {
  const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBaseURL(settings?.baseURL || DEFAULT_BASE_URL);
    setModel(settings?.model || DEFAULT_MODEL);
    setApiKey("");
    setReplaceKey(!settings?.configured);
  }, [open, settings]);

  if (!open) return null;

  const configured = Boolean(settings?.configured);
  const keyPreview = settings?.keyPreview || "";

  function submit(event) {
    event.preventDefault();
    const payload = {
      baseURL: baseURL.trim() || DEFAULT_BASE_URL,
      model: model.trim() || DEFAULT_MODEL
    };
    if (replaceKey) payload.apiKey = apiKey.trim();
    onSave(payload).then((saved) => {
      if (!saved) return;
      setApiKey("");
      setReplaceKey(!saved.configured);
    });
  }

  function clearKey() {
    onSave({
      apiKey: "",
      baseURL: baseURL.trim() || DEFAULT_BASE_URL,
      model: model.trim() || DEFAULT_MODEL
    }).then((saved) => {
      if (!saved) return;
      setApiKey("");
      setReplaceKey(true);
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1d1612]/45 px-4 py-6">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-lg border border-[#d6c8bd] bg-[#fbf6ea] p-5 text-[#3b2630] shadow-panel"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-reader text-xl font-semibold">AI 设置</h2>
            <p className="mt-1 text-sm text-[#765d57]">Key 只保存在本机后端，页面只显示脱敏结果。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#d4bdb0] px-3 py-1.5 text-sm font-semibold transition hover:border-[#6b2f1e]"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-[#5c3c4b]">API Key</span>
            {configured && !replaceKey ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-[#d4bdb0] bg-white/70 px-3 py-2 font-mono text-sm">
                  {keyPreview}
                </span>
                <button
                  type="button"
                  onClick={() => setReplaceKey(true)}
                  className="rounded-md border border-[#d4bdb0] px-3 py-2 text-sm font-semibold transition hover:border-[#6b2f1e]"
                >
                  替换 Key
                </button>
                <button
                  type="button"
                  onClick={clearKey}
                  disabled={saving}
                  className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                >
                  清除
                </button>
              </div>
            ) : (
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="粘贴 OpenAI 兼容 API Key；留空可跳过 AI 解析"
                className="mt-2 h-11 w-full rounded-md border border-[#d4bdb0] bg-white/80 px-3 text-sm outline-none focus:border-[#6b2f1e]"
                autoComplete="off"
              />
            )}
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-[#5c3c4b]">Base URL</span>
            <input
              value={baseURL}
              onChange={(event) => setBaseURL(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-[#d4bdb0] bg-white/80 px-3 text-sm outline-none focus:border-[#6b2f1e]"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-[#5c3c4b]">Model</span>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-[#d4bdb0] bg-white/80 px-3 text-sm outline-none focus:border-[#6b2f1e]"
            />
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#765d57]">
            {configured ? "当前已配置 Key，导入新书会自动解析。" : "未配置 Key 时仍可导入和阅读。"}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#6b2f1e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#8a3c26] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "保存中" : "保存设置"}
          </button>
        </div>
      </form>
    </div>
  );
}
