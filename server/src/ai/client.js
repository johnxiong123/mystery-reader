import OpenAI from 'openai';

export function createAiClient(config) {
  return new OpenAI({
    apiKey: config.ai.apiKey,
    baseURL: config.ai.baseURL
  });
}
