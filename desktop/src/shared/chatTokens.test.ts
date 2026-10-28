import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, estimateTextTokens } from './chatTokens';

describe('token 估算', () => {
  it('中文按字、英文按字符估算', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('你好世界')).toBe(5);
    expect(estimateTextTokens('abcdefgh')).toBe(2);
  });

  it('累加多条消息与数组内容', () => {
    expect(
      estimateMessagesTokens([
        { content: '你好' },
        { content: [{ text: 'abc' }, { text: 'def' }] }
      ])
    ).toBe(estimateTextTokens('你好') + estimateTextTokens('abcdef'));
  });
});
