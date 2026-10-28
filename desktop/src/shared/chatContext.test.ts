import { describe, expect, it } from 'vitest';
import { contextMessages, formatConversationReference } from './chatContext';

describe('清除上下文后的消息切片', () => {
  const rows = ['a', 'b', 'c', 'd'];
  it('未清除时返回全部', () => {
    expect(contextMessages(rows, null)).toEqual(rows);
    expect(contextMessages(rows, 0)).toEqual(rows);
    expect(contextMessages(rows, -1)).toEqual(rows);
  });
  it('从标记位置开始，越界时夹到末尾', () => {
    expect(contextMessages(rows, 2)).toEqual(['c', 'd']);
    expect(contextMessages(rows, 99)).toEqual([]);
    expect(contextMessages(rows, 1.8)).toEqual(['b', 'c', 'd']);
  });
});

describe('引用历史对话', () => {
  it('按角色格式化并保留最近消息', () => {
    const block = formatConversationReference('测试对话', [
      { role: 'user', content: '  问题一  ' },
      { role: 'assistant', content: '回答一' },
      { role: 'user', content: '问题二' }
    ]);
    expect(block.startsWith('> 引用对话「测试对话」')).toBe(true);
    expect(block).toContain('> 用户：问题一');
    expect(block).toContain('> AI：回答一');
    expect(block.endsWith('\n\n')).toBe(true);
  });

  it('空对话给占位，超长时截断', () => {
    expect(formatConversationReference('空', [])).toContain('还没有内容');
    const long = formatConversationReference(
      '长',
      Array.from({ length: 10 }, (_, index) => ({ role: 'user', content: 'x'.repeat(300) + index })),
      500
    );
    expect(long.length).toBeLessThan(700);
  });
});
