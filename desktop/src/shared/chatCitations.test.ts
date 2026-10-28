import { describe, expect, it } from 'vitest';
import { invalidCitationNumbers } from './chatCitations';

describe('引用编号校验', () => {
  it('找出超出范围与 0 编号', () => {
    expect(invalidCitationNumbers('参考 [1] 和 [3] 以及 [9]', 3)).toEqual([9]);
    expect(invalidCitationNumbers('[0] [1]', 2)).toEqual([0]);
    expect(invalidCitationNumbers('没有引用', 3)).toEqual([]);
  });

  it('没有参考文献时任何引用都算无效', () => {
    expect(invalidCitationNumbers('见 [1][2]', 0)).toEqual([1, 2]);
  });
});
