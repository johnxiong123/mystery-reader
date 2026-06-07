import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installErrorHandler } from '../errors.js';
import { registerSettingsRoutes } from './settings.js';
import { createSettingsStore } from '../settings.js';

describe('AI settings routes', () => {
  let tempDir;
  let app;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-reader-settings-'));
    app = Fastify({ logger: false });
    installErrorHandler(app);
    const settingsStore = createSettingsStore({
      dataDir: tempDir,
      settingsPath: path.join(tempDir, 'settings.json'),
      ai: {
        apiKey: '',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini'
      }
    });
    await registerSettingsRoutes(app, { settingsStore });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('保存和读取设置时不返回真实 API Key', async () => {
    const secret = 'sk-test-secret-1234';
    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai',
      payload: {
        apiKey: secret,
        baseURL: 'https://api.deepseek.com',
        model: 'deepseek-chat'
      }
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.body).not.toContain(secret);
    const saved = JSON.parse(saveResponse.body);
    expect(saved).toEqual({
      configured: true,
      keyPreview: 'sk-****1234',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    });

    const getResponse = await app.inject({ method: 'GET', url: '/api/settings/ai' });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.body).not.toContain(secret);
    expect(JSON.parse(getResponse.body).keyPreview).toBe('sk-****1234');
  });

  it('拒绝保存脱敏后的 API Key，并支持清除 Key', async () => {
    const maskedResponse = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai',
      payload: { apiKey: 'sk-****1234' }
    });
    expect(maskedResponse.statusCode).toBe(400);

    const clearResponse = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai',
      payload: { apiKey: '', baseURL: '', model: '' }
    });
    expect(clearResponse.statusCode).toBe(200);
    expect(JSON.parse(clearResponse.body)).toEqual({
      configured: false,
      keyPreview: '',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    });
  });
});
