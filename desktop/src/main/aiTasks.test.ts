import { describe, expect, it } from 'vitest';
import { estimateCost, priceFor, REFERENCE_PRICES } from '../shared/aiTasks';

describe('模型价格与成本估算', () => {
  it('精确匹配参考价', () => {
    const price = priceFor('deepseek-chat', {});
    expect(price).toEqual(REFERENCE_PRICES['deepseek-chat']);
  });

  it('用户覆盖优先于参考价', () => {
    const price = priceFor('deepseek-chat', {
      'deepseek-chat': { input: 100, output: 200 }
    });
    expect(price).toEqual({ input: 100, output: 200 });
  });

  it('带日期后缀的型号按最长前缀匹配', () => {
    const price = priceFor('gpt-4o-2024-08-06', {});
    expect(price).toEqual(REFERENCE_PRICES['gpt-4o']);
  });

  it('未知模型返回 null', () => {
    expect(priceFor('some-unknown-model', {})).toBeNull();
    expect(priceFor('', {})).toBeNull();
  });

  it('按 token 估算成本，缓存命中按半价', () => {
    const overrides = { 'm': { input: 10, output: 20 } };
    // 无缓存：1M 输入 10 元 + 1M 输出 20 元
    expect(estimateCost('m', { inputTokens: 1_000_000, outputTokens: 1_000_000 }, overrides)).toBe(30);
    // 全部命中缓存：输入按 5 元
    expect(
      estimateCost(
        'm',
        { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 },
        overrides
      )
    ).toBe(5);
    // 未知模型没有价格
    expect(estimateCost('unknown', { inputTokens: 100, outputTokens: 100 }, overrides)).toBeNull();
  });
});
