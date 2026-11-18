import { describe, expect, it } from 'vitest';
import {
  chatWebModeHint,
  chatWebModeLabel,
  nextChatWebMode,
  normalizeChatWebMode
} from './chatModes';

describe('对话联网模式', () => {
  it('非法值回退为自动', () => {
    expect(normalizeChatWebMode('force')).toBe('force');
    expect(normalizeChatWebMode('off')).toBe('off');
    expect(normalizeChatWebMode('auto')).toBe('auto');
    expect(normalizeChatWebMode('')).toBe('auto');
    expect(normalizeChatWebMode('yes')).toBe('auto');
    expect(normalizeChatWebMode(null)).toBe('auto');
  });

  it('点击 chip 循环：自动 → 强制 → 关闭 → 自动', () => {
    expect(nextChatWebMode('auto')).toBe('force');
    expect(nextChatWebMode('force')).toBe('off');
    expect(nextChatWebMode('off')).toBe('auto');
  });

  it('标签与说明覆盖三种模式', () => {
    expect(chatWebModeLabel('auto')).toBe('自动');
    expect(chatWebModeLabel('force')).toBe('强制');
    expect(chatWebModeLabel('off')).toBe('关闭');
    expect(chatWebModeHint('auto')).toContain('需要外部事实');
    expect(chatWebModeHint('force')).toContain('强制');
    expect(chatWebModeHint('off')).toContain('不联网');
  });
});
