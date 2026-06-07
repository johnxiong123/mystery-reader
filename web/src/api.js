const API_PREFIX = "/api";

async function readJson(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.error?.message || data?.message || "请求失败";
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function parseJsonText(text) {
  return text ? JSON.parse(text) : {};
}

function createRequestError(status, data, fallback = "请求失败") {
  const message = data?.error?.message || data?.message || fallback;
  const error = new Error(message);
  error.status = status;
  error.payload = data;
  return error;
}

export async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    },
    ...options
  });
  return readJson(response);
}

export const api = {
  health: () => fetchJson("/health"),
  aiSettings: () => fetchJson("/settings/ai"),
  updateAiSettings: (settings) =>
    fetchJson("/settings/ai", {
      method: "PUT",
      body: JSON.stringify(settings)
    }),
  books: () => fetchJson("/books"),
  book: (id) => fetchJson(`/books/${id}`),
  deleteBook: (id) => fetchJson(`/books/${id}`, { method: "DELETE" }),
  chapter: (id, idx) => fetchJson(`/books/${id}/chapters/${idx}`),
  graph: (id, upto) => fetchJson(`/books/${id}/graph?upto=${upto}`),
  character: (id, charId, upto) => fetchJson(`/books/${id}/character/${charId}?upto=${upto}`),
  timeline: (id, upto) => fetchJson(`/books/${id}/timeline?upto=${upto}`),
  progress: (id) => fetchJson(`/books/${id}/progress`),
  updateProgress: (id, currentChapter) =>
    fetchJson(`/books/${id}/progress`, {
      method: "PUT",
      body: JSON.stringify({ current_chapter: currentChapter })
    }),
  reExtractChapter: (bookId, chapterIdx) =>
    fetchJson(`/books/${bookId}/chapters/${chapterIdx}/reextract`, { method: "POST" }),
  reExtractBook: (bookId) =>
    fetchJson(`/books/${bookId}/reextract`, { method: "POST" }),
  importBook: (file, handlers = {}) => {
    const formData = new FormData();
    formData.append("file", file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_PREFIX}/books/import`);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        handlers.onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
      };

      xhr.onload = () => {
        let data = {};
        try {
          data = parseJsonText(xhr.responseText);
        } catch {
          reject(createRequestError(xhr.status, data, "服务器返回了无法解析的结果。"));
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          reject(createRequestError(xhr.status, data));
          return;
        }

        resolve(data);
      };

      xhr.onerror = () => reject(createRequestError(0, {}, "网络连接失败。"));
      xhr.onabort = () => reject(createRequestError(0, {}, "导入已取消。"));
      xhr.send(formData);
    });
  }
};

export function openImportProgress(bookId, handlers) {
  const source = new EventSource(`${API_PREFIX}/books/${bookId}/import-progress`);
  source.onmessage = (event) => {
    try {
      handlers.onProgress?.(JSON.parse(event.data));
    } catch (error) {
      handlers.onError?.(error);
    }
  };
  source.onerror = (error) => {
    handlers.onError?.(error);
    source.close();
  };
  return source;
}
