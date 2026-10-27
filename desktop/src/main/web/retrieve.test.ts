import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../shared/types';

const state = vi.hoisted(() => ({
  searchWebPlan: vi.fn()
}));

vi.mock('./service', () => ({ searchWebPlan: state.searchWebPlan }));

import { retrieveEvidence } from './retrieve';

const settings = {} as AppSettings;

beforeEach(() => {
  state.searchWebPlan.mockReset();
  state.searchWebPlan.mockResolvedValue({
    evidence: [],
    meta: {
      queries: [],
      engine: 'test',
      fallback: false,
      cached: false,
      raw: 0,
      deduped: 0,
      fetched: 0,
      elapsedMs: 0,
      failures: []
    }
  });
});

describe('统一联网策略', () => {
  it('对话：去重后最多 3 条查询，读 2 篇正文', async () => {
    await retrieveEvidence(settings, {
      purpose: 'chat',
      queries: [' A ', 'A', 'B', 'C', 'D', '']
    });
    const args = state.searchWebPlan.mock.calls.at(-1) as unknown as [
      AppSettings,
      Array<{ query: string }>,
      { read: number; maxResults: number }
    ];
    expect(args[1].map((item) => item.query)).toEqual(['A', 'B', 'C']);
    expect(args[2]).toMatchObject({ read: 2, maxResults: 8 });
  });

  it('核对：最多 2 条查询，读 1 篇正文', async () => {
    await retrieveEvidence(settings, {
      purpose: 'verify',
      queries: ['X', 'Y', 'Z']
    });
    const args = state.searchWebPlan.mock.calls.at(-1) as unknown as [
      AppSettings,
      Array<{ query: string }>,
      { read: number; maxResults: number }
    ];
    expect(args[1].map((item) => item.query)).toEqual(['X', 'Y']);
    expect(args[2]).toMatchObject({ read: 1, maxResults: 6 });
  });
});
