import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiPlatform, AppSettings } from '../shared/types';
import type { AiMessage } from './aiClient';

const chatOnceMock = vi.hoisted(() => vi.fn(async () => ({ text: '摘要内容', reasoning: '' })));

vi.mock('./aiClient', () => ({ chatOnce: chatOnceMock }));

import { buildTranscript, clearCompressionCache, compressHistory } from './chatCompression';

const settings = {
  ai: {
    contextAutoCompress: true,
    contextKeepRecent: 4,
    contextCompressTokens: 2000
  }
} as unknown as AppSettings;

const platform = {
  id: 'p',
  name: 'P',
  baseUrl: '',
  apiKey: '',
  model: 'm'
} as AiPlatform;

const messages: AiMessage[] = Array.from({ length: 20 }, (_, index) => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: '很长的对话内容'.repeat(30)
}));

describe('对话压缩辅助', () => {
  beforeEach(() => {
    clearCompressionCache();
    chatOnceMock.mockClear();
  });

  it('按角色拼接摘要文本并截断', () => {
    const rows: AiMessage[] = [
      { role: 'user', content: '  第一问  ' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: 'x'.repeat(2000) }
    ];
    const text = buildTranscript(rows, 500);
    expect(text.startsWith('用户：第一问')).toBe(true);
    expect(text).toContain('AI：第一答');
    expect(text.length).toBeLessThan(800);
  });

  it('超过阈值时生成摘要并保留最近消息', async () => {
    const result = await compressHistory({
      platform,
      messages,
      settings,
      conversationId: 1
    });
    expect(result.compressed).toBe(16);
    expect(result.messages).toHaveLength(5);
    expect(String(result.messages[0].content)).toContain('摘要内容');
    expect(chatOnceMock).toHaveBeenCalledTimes(1);

    const next = await compressHistory({
      platform,
      messages: [
        ...messages,
        { role: 'user', content: '继续' },
        { role: 'assistant', content: '好的' }
      ],
      settings,
      conversationId: 1
    });
    expect(next.compressed).toBe(0);
    expect(chatOnceMock).toHaveBeenCalledTimes(1);
  });

  it('关闭自动压缩或没有会话 id 时原样返回', async () => {
    const disabled = {
      ai: { ...settings.ai, contextAutoCompress: false }
    } as unknown as AppSettings;
    expect(
      (await compressHistory({ platform, messages, settings: disabled, conversationId: 1 }))
        .messages
    ).toBe(messages);
    expect(
      (await compressHistory({ platform, messages, settings, conversationId: undefined }))
        .messages
    ).toBe(messages);
    expect(chatOnceMock).not.toHaveBeenCalled();
  });
});
