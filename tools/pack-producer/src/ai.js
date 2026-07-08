import { getConfig } from '../../../server/src/config.js';
import { createAiClient } from '../../../server/src/ai/client.js';
import { isUnsupportedResponseFormatError } from '../../../server/src/ingest/extractor.js';

const RETRIES = 3;

export function createProducerAi(overrides = {}) {
  let client = overrides.client;
  let model = overrides.model;
  if (!client) {
    const config = getConfig();
    if (!config.ai.apiKey) throw new Error('缺少 AI_API_KEY（根目录 .env）。');
    client = createAiClient(config);
    model = model || config.ai.model;
  }
  let jsonModeAvailable = true;

  async function call(messages, { jsonMode }) {
    const request = { model, messages };
    if (jsonMode) request.response_format = { type: 'json_object' };
    const completion = await client.chat.completions.create(request);
    return completion.choices?.[0]?.message?.content || '';
  }

  async function withRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  return {
    model,
    chatText: (messages) => withRetry(() => call(messages, { jsonMode: false })),
    chatJson: (messages) => withRetry(async () => {
      try {
        return parseJson(await call(messages, { jsonMode: jsonModeAvailable }));
      } catch (error) {
        if (jsonModeAvailable && isUnsupportedResponseFormatError(error)) {
          jsonModeAvailable = false;
          return parseJson(await call(messages, { jsonMode: false }));
        }
        throw error;
      }
    })
  };
}

function parseJson(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}
