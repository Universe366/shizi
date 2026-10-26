import { describe, expect, it } from 'vitest';
import { packMergeGroups } from './summarizeMerge';

describe('packMergeGroups', () => {
  it('按预算分组，不丢内容', () => {
    const items = ['a'.repeat(8000), 'b'.repeat(8000), 'c'.repeat(8000)];
    const groups = packMergeGroups(items, 20000);
    expect(groups.length).toBe(2);
    expect(groups.flat().join('').length).toBe(24000);
    expect(groups.every((group) => group.join('').length <= 20000)).toBe(true);
  });

  it('单条超过预算时截断而不是生成空组', () => {
    const groups = packMergeGroups(['x'.repeat(30000)], 10000);
    expect(groups).toHaveLength(1);
    expect(groups[0][0].length).toBe(10000);
  });

  it('过滤空项', () => {
    expect(packMergeGroups(['', '  ', 'ok'], 1000)).toEqual([['ok']]);
  });
});
