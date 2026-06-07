import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export function createSettingsStore(config) {
  const settingsPath = config.settingsPath || path.join(config.dataDir, 'settings.json');

  function readFileSettings() {
    if (!fs.existsSync(settingsPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function getAiSettings() {
    const stored = readFileSettings();
    const hasStoredKey = Object.prototype.hasOwnProperty.call(stored, 'apiKey');
    const apiKey = normalizeApiKey(hasStoredKey ? stored.apiKey : config.ai?.apiKey);
    const baseURL = normalizeText(stored.baseURL) || normalizeText(config.ai?.baseURL) || DEFAULT_BASE_URL;
    const model = normalizeText(stored.model) || normalizeText(config.ai?.model) || DEFAULT_MODEL;

    return {
      apiKey,
      baseURL,
      model,
      configured: Boolean(apiKey)
    };
  }

  function getPublicAiSettings() {
    const settings = getAiSettings();
    return {
      configured: settings.configured,
      keyPreview: maskApiKey(settings.apiKey),
      baseURL: settings.baseURL,
      model: settings.model
    };
  }

  function saveAiSettings(patch = {}) {
    const current = getAiSettings();
    const next = {
      apiKey: current.apiKey,
      baseURL: current.baseURL,
      model: current.model
    };

    if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
      const apiKey = normalizeApiKey(patch.apiKey);
      if (isMaskedApiKey(apiKey)) {
        throw new Error('不能保存脱敏后的 API Key，请输入完整 Key 或留空清除。');
      }
      next.apiKey = apiKey;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'baseURL')) {
      next.baseURL = normalizeText(patch.baseURL) || DEFAULT_BASE_URL;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
      next.model = normalizeText(patch.model) || DEFAULT_MODEL;
    }

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return getPublicAiSettings();
  }

  return {
    getAiSettings,
    getPublicAiSettings,
    saveAiSettings
  };
}

export function maskApiKey(apiKey) {
  const value = normalizeApiKey(apiKey);
  if (!value) return '';
  const tail = value.slice(-4);
  if (value.startsWith('sk-')) return `sk-****${tail}`;
  return `${value.slice(0, 2)}****${tail}`;
}

export function isMaskedApiKey(apiKey) {
  return /\*{2,}/.test(String(apiKey || ''));
}

function normalizeApiKey(value) {
  const text = normalizeText(value);
  if (!text || text === 'sk-xxxx') return '';
  return text;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
