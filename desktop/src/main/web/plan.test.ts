import { describe, expect, it } from 'vitest';
import { buildSearchPlan } from './plan';

describe('buildSearchPlan', () => {
  it('第一条永远是主查询，最多 4 条', () => {
    const plan = buildSearchPlan('DeepSeek V4 什么时候发布', { maxQueries: 4 });
    expect(plan[0].angle).toBe('base');
    expect(plan.length).toBeLessThanOrEqual(4);
    expect(plan[0].query).toContain('DeepSeek');
  });

  it('时效问题会追加「最新进展」', () => {
    const plan = buildSearchPlan('今年显卡价格怎么样', { maxQueries: 2 });
    expect(plan).toHaveLength(2);
    expect(plan[1].angle).toBe('fresh');
    expect(plan[1].query).toContain('最新');
  });

  it('对比类问题用对比角度', () => {
    const plan = buildSearchPlan('Whisper 和 SenseVoice 哪个好', { maxQueries: 2 });
    expect(plan[1].query).toContain('对比');
  });

  it('普通问题不强行扩展泛化查询', () => {
    const plan = buildSearchPlan('React 19 的并发渲染', { maxQueries: 3 });
    expect(plan).toHaveLength(1);
    const summary = buildSearchPlan('', {
      scope: 'summary',
      title: 'React 19 并发渲染',
      maxQueries: 3
    });
    expect(summary.some((item) => item.angle === 'primary')).toBe(true);
  });

  it('总结场景用标题作为主查询', () => {
    const plan = buildSearchPlan('', { scope: 'summary', title: '本地 ASR 测试', maxQueries: 2 });
    expect(plan[0].query).toBe('本地 ASR 测试');
    expect(plan[0].angle).toBe('base');
  });

  it('空问题返回空计划', () => {
    expect(buildSearchPlan('   ', { title: '' })).toEqual([]);
  });
});