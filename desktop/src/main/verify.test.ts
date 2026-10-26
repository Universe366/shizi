import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/shizi-test' },
  session: { defaultSession: { fetch: vi.fn() } },
  safeStorage: { isEncryptionAvailable: () => false }
}));

import { parseJudgeJson, parseSearchQueries, quoteMatches } from './verify';

describe('verify quote matching', () => {
  it('忽略标点、空白和大小写', () => {
    expect(quoteMatches('2026年4月24日，正式发布', '2026 年 4 月 24 日 正式发布 DeepSeek-V4')).toBe(
      true
    );
    expect(quoteMatches('DeepSeek V4', 'deepseek-v4 发布')).toBe(true);
    expect(quoteMatches('需要 4 个字符以上', '需要4个字符以上')).toBe(true);
  });

  it('太短或对不上的 quote 不算', () => {
    expect(quoteMatches('支持', '这段证据支持结论')).toBe(false);
    expect(quoteMatches('证据里没有这句话', '另一段完全不同的证据')).toBe(false);
  });
});

describe('parseSearchQueries', () => {
  it('能处理 JSON 前后的解释文字', () => {
    expect(parseSearchQueries('好的，查询如下：\n["DeepSeek V4 发布时间", "6710 亿参数"]\n以上。')).toEqual([
      'DeepSeek V4 发布时间',
      '6710 亿参数'
    ]);
  });

  it('能处理 {queries:[...]} 与编号行', () => {
    expect(parseSearchQueries('{"queries":["A 产品 价格"]}')).toEqual(['A 产品 价格']);
    expect(parseSearchQueries('1. 苏联 1985 年改革\n2. 苏联 解体 时间')).toEqual([
      '苏联 1985 年改革',
      '苏联 解体 时间'
    ]);
  });
});

describe('parseJudgeJson', () => {
  it('能从代码块/前后解释里取 JSON', () => {
    const parsed = parseJudgeJson('判定：\n```json\n{"judgments":[{"id":"E1","verdict":"support"}]}\n```');
    const object = parsed && !Array.isArray(parsed) ? parsed : {};
    expect(Array.isArray(object.judgments)).toBe(true);
  });

  it('兼容模型直接返回数组', () => {
    const parsed = parseJudgeJson('结果：[{"id":"E1","verdict":"refute"}]');
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('容忍尾逗号', () => {
    const parsed = parseJudgeJson('{"judgments":[{"id":"E1","verdict":"support"},],}');
    const object = parsed && !Array.isArray(parsed) ? parsed : {};
    expect(Array.isArray(object.judgments)).toBe(true);
  });

  it('没有 JSON 时返回 null', () => {
    expect(parseJudgeJson('无法判断')).toBeNull();
  });
});
