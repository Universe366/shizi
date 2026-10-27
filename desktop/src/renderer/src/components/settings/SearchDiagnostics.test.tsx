// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SearchDiagnostics } from './SearchDiagnostics';

function installBsub() {
  const api = {
    webMetrics: vi.fn(async () => ({
      ok: true as const,
      data: {
        stats: {
          count: 3,
          avgLatency: 120,
          dedupeRate: 0.5,
          failureRate: 0.25,
          fetched: 5,
          lastAt: Date.now()
        },
        recent: [
          {
            at: Date.now(),
            queries: ['q1', 'q2'],
            engine: 'Exa',
            fallback: false,
            cached: false,
            raw: 8,
            deduped: 4,
            fetched: 2,
            elapsedMs: 120,
            failures: 0
          }
        ],
        cacheSize: 7
      }
    })),
    webMetricsClear: vi.fn(async () => ({ ok: true as const, data: 3 })),
    webCacheClear: vi.fn(async () => ({ ok: true as const, data: 7 }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('SearchDiagnostics', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('展示统计并支持清空抓取缓存', async () => {
    const api = installBsub();
    render(<SearchDiagnostics />);
    expect(await screen.findByText('120 ms')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('7 篇')).toBeTruthy();
    fireEvent.click(screen.getByText('清空抓取缓存'));
    await waitFor(() => expect(api.webCacheClear).toHaveBeenCalled());
  });
});
