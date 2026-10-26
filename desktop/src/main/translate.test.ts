import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, SubtitleLine } from '../shared/types';

const chatOnce = vi.hoisted(() => vi.fn());
const translateFree = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => ({}) as AppSettings);
const platform = vi.hoisted(() => ({
  id: 'test',
  label: 'Test',
  baseUrl: 'https://example.com/v1',
  apiKey: 'k',
  model: 'm'
}));

vi.mock('./aiClient', () => ({ chatOnce }));
vi.mock('./freeTranslate', () => ({ translateFree }));
vi.mock('./settings', () => ({
  loadSettings: () => settings,
  activePlatform: () => platform
}));
vi.mock('./platformKey', () => ({ needsApiKey: () => false }));

import { translateLines } from './translate';

function line(index: number): SubtitleLine {
  return { start: index, end: index + 1, text: `line ${index}` };
}

beforeEach(() => {
  chatOnce.mockReset();
  translateFree.mockReset();
  translateFree.mockImplementation(async (texts: string[]) => texts.map((text) => `免费 ${text}`));
  Object.assign(settings, {
    prompt: { translate: 'translate prompt' },
    ai: { maxTokens: 1000 },
    general: {
      translateContext: true,
      translateReflect: false,
      translateConcurrency: 2
    },
    correction: { glossary: { enabled: false, terms: [] } }
  });
  chatOnce.mockImplementation(async (_platform, messages) => {
    const user = String(messages[messages.length - 1]?.content || '');
    const count = Number(/共 (\d+) 条字幕/.exec(user)?.[1] || 1);
    return { text: JSON.stringify({ lines: Array.from({ length: count }, (_, i) => `译 ${i}`) }) };
  });
});

describe('translateLines', () => {
  it('按并发批处理，批间带前后文，顺序不变', async () => {
    const lines = Array.from({ length: 45 }, (_, index) => line(index));
    const result = await translateLines(
      lines,
      '中文（简体）',
      () => undefined,
      undefined,
      settings,
      { concurrency: 2, useContext: true }
    );
    expect(chatOnce).toHaveBeenCalledTimes(2);
    expect(result.lines).toHaveLength(45);
    expect(result.lines[0].text).toBe('译 0');
    expect(result.lines[44].text).toBe('译 4');
    const prompts = chatOnce.mock.calls.map((call) => String(call[1][1].content));
    expect(prompts[0]).toContain('后文');
    expect(prompts[1]).toContain('前文');
  });

  it('开启反思时每批多一次审校，保留审校结果', async () => {
    chatOnce.mockImplementationOnce(async (_platform, messages) => {
      const user = String(messages[1].content);
      const count = Number(/共 (\d+) 条字幕/.exec(user)?.[1] || 1);
      return { text: JSON.stringify({ lines: Array.from({ length: count }, () => '初译') }) };
    });
    chatOnce.mockImplementationOnce(async () => ({
      text: JSON.stringify({ lines: ['审校后'] })
    }));
    const result = await translateLines([line(0)], 'English', () => undefined, undefined, settings, {
      reflect: true
    });
    expect(chatOnce).toHaveBeenCalledTimes(2);
    expect(result.lines[0].text).toBe('审校后');
  });

  it('AI 失败且开启免费兜底时使用免费翻译', async () => {
    chatOnce.mockRejectedValueOnce(new Error('quota'));
    const result = await translateLines([line(0)], 'English', () => undefined, undefined, settings, {
      freeFallback: true
    });
    expect(translateFree).toHaveBeenCalledTimes(1);
    expect(result.lines[0].text).toBe('免费 line 0');
  });
});
