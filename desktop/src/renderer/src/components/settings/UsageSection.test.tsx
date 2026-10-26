// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppSettings, UsageEvent, UsageSummary } from '../../../../shared/types';
import { UsageSection } from './UsageSection';

const summary: UsageSummary = {
  totals: { requests: 3, inputTokens: 3300, outputTokens: 1500, cacheReadTokens: 100 },
  byModel: [
    {
      model: 'deepseek-chat',
      requests: 3,
      inputTokens: 3300,
      outputTokens: 1500,
      cacheReadTokens: 100
    }
  ],
  byTask: [{ task: 'summary', requests: 3, inputTokens: 3300, outputTokens: 1500, cacheReadTokens: 0 }],
  byDay: []
};

const events: UsageEvent[] = [
  {
    id: 1,
    createdAt: Date.now(),
    task: 'summary',
    platformId: 'deepseek',
    platformName: 'DeepSeek',
    model: 'deepseek-chat',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0
  }
];

const value: AppSettings['usage'] = { enabled: true, prices: {} };

describe('用量统计面板', () => {
  const usageSummary = vi.fn(async () => ({ ok: true as const, data: summary }));
  const usageEvents = vi.fn(async () => ({ ok: true as const, data: events }));

  beforeEach(() => {
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

  it('展示请求数、模型与任务', async () => {
    render(<UsageSection value={value} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('deepseek-chat').length).toBeGreaterThan(0));
    expect(screen.getByText('请求数')).toBeTruthy();
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('总结').length).toBeGreaterThan(0);
    expect(screen.getByText('近 30 天')).toBeTruthy();
  });

  it('切换区间重新汇总', async () => {
    render(<UsageSection value={value} onChange={vi.fn()} />);
    await waitFor(() => expect(usageSummary).toHaveBeenCalledWith(30));
    fireEvent.click(screen.getByText('近 7 天'));
    await waitFor(() => expect(usageSummary).toHaveBeenCalledWith(7));
  });
});
