import { describe, expect, it } from 'vitest';
import { contextMessages } from './chatContext';

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
