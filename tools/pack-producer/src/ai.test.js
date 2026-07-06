import { describe, expect, it, vi } from 'vitest';
import { createProducerAi } from './ai.js';

function mockClient(responses) {
  const create = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) create.mockRejectedValueOnce(r);
    else create.mockResolvedValueOnce({ choices: [{ message: { content: r } }] });
  }
  return { client: { chat: { completions: { create } } }, create };
}

describe('createProducerAi', () => {
  it('chatJson 解析 JSON（含 ```json 围栏）', async () => {
    const { client } = mockClient(['```json\n{"a":1}\n```']);
    const ai = createProducerAi({ client, model: 'test-model' });
    expect(await ai.chatJson([{ role: 'user', content: 'x' }])).toEqual({ a: 1 });
  });

  it('response_format 不支持时降级重试', async () => {
    const err = Object.assign(new Error('response_format is unsupported'), { status: 400 });
    const { client, create } = mockClient([err, '{"ok":true}']);
    const ai = createProducerAi({ client, model: 'test-model' });
    expect(await ai.chatJson([{ role: 'user', content: 'x' }])).toEqual({ ok: true });
    expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
    expect(create.mock.calls[1][0].response_format).toBeUndefined();
  });

  it('连续失败 3 次后抛错', async () => {
    const boom = new Error('rate limited');
    const { client } = mockClient([boom, boom, boom]);
    const ai = createProducerAi({ client, model: 'test-model' });
    await expect(ai.chatText([{ role: 'user', content: 'x' }])).rejects.toThrow('rate limited');
  });
});
