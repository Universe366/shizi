// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClearBrowsingDataDialog } from './ClearBrowsingDataDialog';

type RangePayload = {
  since?: number;
  history?: boolean;
  downloads?: boolean;
  cookies?: boolean;
  cache?: boolean;
};

function installBsub() {
  const api = {
    clearBrowsingDataRange: vi.fn(async (_payload: RangePayload) => ({
      ok: true as const,
      data: { history: 3, downloads: 1 }
    }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClearBrowsingDataDialog', () => {
  it('默认清最近 1 小时的历史与下载记录', async () => {
    const api = installBsub();
    const before = Date.now();
    render(<ClearBrowsingDataDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('清除数据'));

    await waitFor(() => expect(api.clearBrowsingDataRange).toHaveBeenCalled());
    const payload = api.clearBrowsingDataRange.mock.calls[0][0];
    expect(payload.history).toBe(true);
    expect(payload.downloads).toBe(true);
    expect(payload.cookies).toBe(false);
    expect(payload.cache).toBe(false);
    expect(payload.since).toBeGreaterThanOrEqual(before - 3_600_000 - 1000);
    expect(await screen.findByText(/已清理：历史 3 条、下载记录 1 条/)).toBeTruthy();
  });

  it('全部时间传 since=0', async () => {
    const api = installBsub();
    render(<ClearBrowsingDataDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } });
    fireEvent.click(screen.getByText('清除数据'));
    await waitFor(() => expect(api.clearBrowsingDataRange).toHaveBeenCalled());
    expect(api.clearBrowsingDataRange.mock.calls[0][0].since).toBe(0);
  });
});
