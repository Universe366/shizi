import { describe, expect, it } from 'vitest';
import { selectByAllowed } from '../shared/toolSelection';

const tools = [
  { qualifiedName: 'srv1__a' },
  { qualifiedName: 'srv1__b' },
  { qualifiedName: 'srv2__c' }
];

describe('对话级工具白名单', () => {
  it('不传时返回全部', () => {
    expect(selectByAllowed(tools)).toEqual(tools);
  });

  it('空数组表示一个都不用', () => {
    expect(selectByAllowed(tools, [])).toEqual([]);
  });

  it('只保留勾选的工具', () => {
    expect(selectByAllowed(tools, ['srv1__b', 'srv2__c']).map((item) => item.qualifiedName)).toEqual([
      'srv1__b',
      'srv2__c'
    ]);
  });

  it('无效 id 被忽略', () => {
    expect(selectByAllowed(tools, ['nope'])).toEqual([]);
  });
});
