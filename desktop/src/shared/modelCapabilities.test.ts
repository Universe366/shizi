import { describe, expect, it } from 'vitest';
import {
  capabilityKey,
  effectiveModelCapabilities,
  formatContextWindow,
  inferContextWindow,
  inferModelCapabilities,
  moveListItem
} from './modelCapabilities';

describe('模型能力识别', () => {
  it('识别常见视觉/音频模型', () => {
    expect(inferModelCapabilities('openai', 'gpt-4o').vision).toBe(true);
    expect(inferModelCapabilities('anthropic', 'claude-3-7-sonnet').vision).toBe(true);
    expect(inferModelCapabilities('openai', 'qwen2.5-vl-72b').vision).toBe(true);
    expect(inferModelCapabilities('openai', 'gpt-4o-audio-preview').audio).toBe(true);
  });

  it('列表重排：移动、越界与同位置', () => {
    expect(moveListItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveListItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveListItem(['a', 'b'], 1, 5)).toEqual(['a', 'b']);
    expect(moveListItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('按模型名推断上下文窗口', () => {
    expect(formatContextWindow(inferContextWindow('gemini-2.5-pro'))).toBe('1M');
    expect(formatContextWindow(inferContextWindow('claude-3-7-sonnet'))).toBe('200k');
    expect(formatContextWindow(inferContextWindow('gpt-4o'))).toBe('128k');
    expect(formatContextWindow(inferContextWindow('qwen2.5:7b'))).toBe('33k');
    expect(inferContextWindow('unknown-model')).toBe(0);
  });

  it('普通文本模型不误判', () => {
    const caps = inferModelCapabilities('openai', 'gpt-3.5-turbo');
    expect(caps.vision).toBe(false);
    expect(caps.audio).toBe(false);
    expect(caps.text).toBe(true);
  });

  it('用户覆盖优先于自动识别', () => {
    const key = capabilityKey('p1', 'GPT-4O');
    expect(key).toBe('p1::gpt-4o');
    expect(
      effectiveModelCapabilities('openai', 'gpt-4o', { vision: false }).vision
    ).toBe(false);
    expect(
      effectiveModelCapabilities('openai', 'gpt-3.5-turbo', { vision: true }).vision
    ).toBe(true);
  });
});
