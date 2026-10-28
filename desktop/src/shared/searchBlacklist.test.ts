import { describe, expect, it } from 'vitest';
import { parseUblacklist } from './searchBlacklist';

describe('ublacklist 规则导入', () => {
  it('解析纯文本、去重并忽略注释', () => {
    const rules = parseUblacklist(`
# 注释
*://*.example.com/*
/example\\.(net|org)/
*://*.example.com/*
`);
    expect(rules).toEqual(['*://*.example.com/*', '/example\\.(net|org)/']);
  });

  it('解析 JSON 顶层与嵌套 rules', () => {
    expect(parseUblacklist(JSON.stringify({ rules: ['a', 'b'] }))).toEqual(['a', 'b']);
    expect(
      parseUblacklist(JSON.stringify({ data: { rules: ['*://*.a.com/*'] } }))
    ).toEqual(['*://*.a.com/*']);
  });

  it('空内容与非法 JSON 回退为文本', () => {
    expect(parseUblacklist('')).toEqual([]);
    expect(parseUblacklist('{bad json')).toEqual(['{bad json']);
  });
});
