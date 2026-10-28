// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppSettings, UsageEvent, UsageSummary } from '../../../../shared/types';
import { UsageSection } from './UsageSection';
import { dateKey } from '../../lib/usageStats';

const now = Date.now();
const today = dateKey(new Date());

const summary: UsageSummary = {
  totals: { requests: 3, inputTokens: 3300, outputTokens: 1500, cacheReadTokens: 300 },
  byModel: [
    {
      model: 'deepseek-chat',
      requests: 3,
      inputTokens: 3300,
      outputTokens: 1500,
      cacheReadTokens: 300
    }
  ],
  byPlatform: [
    {
      platformId: 'deepseek',
      platformName: 'DeepSeek',
      requests: 3,
      inputTokens: 3300,
      outputTokens: 1500,
      cacheReadTokens: 300
    }
  ],
  byTask: [
    {
      task: 'summary',
      requests: 3,
      inputTokens: 3300,
      outputTokens: 1500,
      cacheReadTokens: 0
    }
  ],
  byDay: [
    { day: today, requests: 3, inputTokens: 3300, outputTokens: 1500, cacheReadTokens: 300 }
  ],
  byPlatformModel: [
    {
      platformId: 'deepseek',
      platformName: 'DeepSeek',
      model: 'deepseek-chat',
      requests: 3,
      inputTokens: 3300,
      outputTokens: 1500,
      cacheReadTokens: 300
    }
  ],
  byTaskModel: [
    {
      task: 'summary',
      model: 'deepseek-chat',
      requests: 3,
      inputTokens: 3300,
      outputTokens: 1500,
      cacheReadTokens: 0
    }
  ],
  byDayModel: [
    {
      day: today,
      model: 'deepseek-chat',
      requests: 3,
      inputTokens: 3300,
      outputTokens: 1500,
      cacheReadTokens: 300
    }
  ]
};

const events: UsageEvent[] = [
  {
    id: 1,
    createdAt: now,
    task: 'summary',
    platformId: 'deepseek',
    platformName: 'DeepSeek',
    model: 'deepseek-chat',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 100
  }
];

const value: AppSettings['usage'] = { enabled: true, prices: {} };

describe('用量统计面板', () => {
  const usageSummary = vi.fn(async () => ({ ok: true as const, data: summary }));
  const usageEvents = vi.fn(async () => ({ ok: true as const, data: events }));

  beforeEach(() => {
    localStorage.clear();
    usageSummary.mockClear();
    usageEvents.mockClear();
    (window as unknown as { bsub: unknown }).bsub = {
      usageSummary,
      usageEvents,
      exportUsage: vi.fn(async () => ({ ok: true as const, data: { canceled: true } })),
      clearUsage: vi.fn(async () => ({ ok: true as const, data: { removed: 0 } }))
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('展示概览、缓存命中率与模型明细', async () => {
    render(<UsageSection value={value} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('deepseek-chat').length).toBeGreaterThan(0));
    expect(screen.getAllByText('请求数').length).toBeGreaterThan(0);
    expect(screen.getByText('缓存命中率')).toBeTruthy();
    expect(screen.getByText('9.1%')).toBeTruthy();
    expect(screen.getByText('活跃天数')).toBeTruthy();
    expect(screen.getByText('最常用模型')).toBeTruthy();
    expect(screen.getAllByText('总结').length).toBeGreaterThan(0);
    expect(screen.getByText('近 30 天')).toBeTruthy();
  });

  it('切换区间重新汇总，并重置已选日期', async () => {
    render(<UsageSection value={value} onChange={vi.fn()} />);
    await waitFor(() => expect(usageSummary).toHaveBeenCalledWith(30));
    fireEvent.click(screen.getByText('近 7 天'));
    await waitFor(() => expect(usageSummary).toHaveBeenCalledWith(7));
    expect(usageEvents).toHaveBeenLastCalledWith(30, '', 7);
  });

  it('点击热力图查看当天明细', async () => {
    render(<UsageSection value={value} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTitle(new RegExp(today)).length).toBeGreaterThan(0));
    const cell = screen.getAllByTitle(new RegExp(today))[0];
    fireEvent.click(cell);
    await waitFor(() => expect(usageEvents).toHaveBeenLastCalledWith(200, today, 30));
    expect(screen.getByText(new RegExp(`当天明细：${today}`))).toBeTruthy();
  });

  it('分布分析可以按平台分组', async () => {
    render(<UsageSection value={value} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('deepseek-chat').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('分组方式'), { target: { value: 'platform' } });
    await waitFor(() => expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0));
  });
});
