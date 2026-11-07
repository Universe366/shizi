import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, SearchPlatform } from '../../../shared/types';

const state = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('electron', () => ({
  session: { defaultSession: { fetch: state.fetch } }
}));

import { searchExaApi } from './exaApi';
import { searchFirecrawl } from './firecrawl';
import { searchQuerit } from './querit';
import { parseTencentSecret, searchTencent } from './tencent';

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

  it('解析 Querit 的 results.result 与 highlights', async () => {
    state.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: {
            result: [
              {
                title: 'C',
                url: 'https://c.com',
                snippet: '摘要',
                highlights: ['高亮一', '高亮二']
              }
            ]
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const rows = await searchQuerit(settings, platform('querit', 'https://api.querit.ai/v1/search'), '测试');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'C',
      url: 'https://c.com',
      snippet: '高亮一 高亮二'
    });
  });

  it('缺少 Key 时直接报错', async () => {
    await expect(
      searchFirecrawl(settings, platform('firecrawl', 'https://api.firecrawl.dev/v1/search', ''), 'x')
    ).rejects.toThrow('API Key');
    await expect(
      searchExaApi(settings, platform('exa-api', 'https://api.exa.ai/search', ''), 'x')
    ).rejects.toThrow('API Key');
  });

  it('腾讯云元宝搜索：TC3 签名、Pages 解析与结果映射', async () => {
    state.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          Response: {
            Pages: [
              JSON.stringify({
                title: '腾讯结果',
                url: 'https://tencent.com/a',
                passage: '标准摘要',
                site: 'tencent.com',
                date: '2026-01-02'
              })
            ],
            Version: 'standard',
            RequestId: 'req-1'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const rows = await searchTencent(
      settings,
      platform('tencent-wsa', 'https://wsa.tencentcloudapi.com', 'AKID:SK'),
      '测试'
    );
    expect(rows[0]).toMatchObject({
      title: '腾讯结果',
      url: 'https://tencent.com/a',
      snippet: '标准摘要',
      site: 'tencent.com',
      date: '2026-01-02'
    });
    const init = state.fetch.mock.calls.at(-1)?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^TC3-HMAC-SHA256 Credential=AKID\/\d{4}-\d{2}-\d{2}\/wsa\/tc3_request/);
    expect(headers['x-tc-action']).toBe('SearchPro');
    expect(headers['x-tc-version']).toBe('2025-05-08');
    const body = JSON.parse(String(init.body));
    expect(body.Query).toBe('测试');
    expect(body.Cnt).toBe(10);
  });

  it('腾讯云元宝搜索：Key 格式与接口错误都有可读提示', async () => {
    await expect(
      searchTencent(
        settings,
        platform('tencent-wsa', 'https://wsa.tencentcloudapi.com', 'only-secret-id'),
        'x'
      )
    ).rejects.toThrow('SecretId:SecretKey');
    state.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: '签名错误' } }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    await expect(
      searchTencent(
        settings,
        platform('tencent-wsa', 'https://wsa.tencentcloudapi.com', 'AKID:SK'),
        'x'
      )
    ).rejects.toThrow('AuthFailure.SignatureFailure');
    expect(parseTencentSecret('AKID:SK')).toEqual({ secretId: 'AKID', secretKey: 'SK' });
  });
});
