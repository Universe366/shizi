import { describe, expect, it } from 'vitest';
import {
  capabilityKey,
  effectiveModelCapabilities,
  inferModelCapabilities
} from './modelCapabilities';

describe('模型能力识别', () => {
  it('识别常见视觉/音频模型', () => {
    expect(inferModelCapabilities('openai', 'gpt-4o').vision).toBe(true);
    expect(inferModelCapabilities('anthropic', 'claude-3-7-sonnet').vision).toBe(true);
    expect(inferModelCapabilities('openai', 'qwen2.5-vl-72b').vision).toBe(true);
    expect(inferModelCapabilities('openai', 'gpt-4o-audio-preview').audio).toBe(true);
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
