import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, SearchPlatform } from '../../../shared/types';

const state = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('electron', () => ({
  session: { defaultSession: { fetch: state.fetch } }
}));

import { searchExaApi } from './exaApi';
import { searchFirecrawl } from './firecrawl';

const settings = {
  search: { maxResults: 5, snippetChars: 2000 },
  ai: { platforms: [] }
} as unknown as AppSettings;

const platform = (kind: string, baseUrl: string, apiKey = 'key'): SearchPlatform => ({
  id: kind,
  name: kind,
  kind,
  baseUrl,
  apiKey
});

describe('Firecrawl / Exa API 搜索', () => {
  beforeEach(() => state.fetch.mockReset());

  it('解析 Firecrawl data 数组', async () => {
    state.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [{ title: 'A', url: 'https://a.com', markdown: '正文 A' }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const rows = await searchFirecrawl(
      settings,
      platform('firecrawl', 'https://api.firecrawl.dev/v1/search'),
      '测试'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'A', url: 'https://a.com', snippet: '正文 A' });
    const init = state.fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key');
  });

  it('解析 Exa API results 数组并带 x-api-key', async () => {
    state.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ title: 'B', url: 'https://b.com', text: '正文 B' }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const rows = await searchExaApi(
      settings,
      platform('exa-api', 'https://api.exa.ai/search'),
      '测试'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'B', url: 'https://b.com', snippet: '正文 B' });
    const init = state.fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('key');
  });

  it('缺少 Key 时直接报错', async () => {
    await expect(
      searchFirecrawl(settings, platform('firecrawl', 'https://api.firecrawl.dev/v1/search', ''), 'x')
    ).rejects.toThrow('API Key');
    await expect(
      searchExaApi(settings, platform('exa-api', 'https://api.exa.ai/search', ''), 'x')
    ).rejects.toThrow('API Key');
  });
});
