import { describe, expect, it } from 'vitest';
import { neighborAfterClose } from './tabOrder';

describe('neighborAfterClose', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('优先选择右边的标签', () => {
    expect(neighborAfterClose(ids, 'b')).toBe('c');
  });

  it('关闭最后一个时回退到左边', () => {
    expect(neighborAfterClose(ids, 'd')).toBe('c');
  });

  it('只有一个标签时返回 null', () => {
    expect(neighborAfterClose(['a'], 'a')).toBeNull();
    expect(neighborAfterClose([], 'a')).toBeNull();
  });

  it('找不到时退回最后一个', () => {
    expect(neighborAfterClose(ids, 'x')).toBe('d');
  });
});
