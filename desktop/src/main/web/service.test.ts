import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, WebReference } from '../../shared/types';

const state = vi.hoisted(() => ({
  rows: [] as WebReference[],
  calls: [] as string[]
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/shizi-plan-cache-test' }
}));

vi.mock('../search', () => ({
  runProviderSearch: vi.fn(async (_settings: unknown, _platform: unknown, query: string) => {
    state.calls.push(query);
    return state.rows;
  }),
  prepareResults: vi.fn(async (rows: WebReference[]) => rows),
  fetchPageText: vi.fn(async () => ''),
  freePlatform: vi.fn(() => ({ id: 'free', name: 'Free', kind: 'anysearch', baseUrl: '' })),
  withSearchSignal: vi.fn((_signal: unknown, task: () => Promise<unknown>) => task())
}));

import {
  capPerDomain,
  dedupeEvidence,
  normalizeUrl,
  rankEvidence,
  searchWebPlan,
  siteOf,
  sourceTypeOf
} from './service';

function settings(overrides: Partial<AppSettings['search']> = {}): AppSettings {
  return {
    search: {
      enabled: true,
      activeId: 'p',
      platforms: [{ id: 'p', name: 'P', kind: 'custom', baseUrl: 'https://x.test' }],
      maxResults: 5,
      includeContent: true,
      timeRange: 'any',
      verify: false,
      verifySummary: true,
      verifyItemCount: 8,
      keylessFallback: false,
      keylessOrder: [],
      cacheMinutes: 0,
      autoSearchOnChat: false,
      autoSearchAi: false,
      alwaysSearchOnChat: false,
      useVideoMeta: true,
      useComments: true,
      aiQueryGeneration: true,
      extraVerifyQueries: '',
      fetchPages: false,
      snippetChars: 1200,
      blacklist: [],
      planQueries: 3,
      ...overrides
    }
  } as unknown as AppSettings;
}

const ref = (url: string, title: string, extra: Partial<WebReference> = {}): WebReference => ({
  title,
  url,
  snippet: `${title} 的摘要`,
  ...extra
});

describe('web service helpers', () => {
  it('siteOf / normalizeUrl 去掉无关参数', () => {
    expect(siteOf('https://www.Example.com/a')).toBe('example.com');
    expect(normalizeUrl('https://example.com/a/?utm_source=x&b=1#top')).toBe('https://example.com/a?b=1');
  });

  it('sourceTypeOf 识别官方/仓库/论文/论坛', () => {
    expect(sourceTypeOf('github.com')).toBe('repo');
    expect(sourceTypeOf('arxiv.org')).toBe('paper');
    expect(sourceTypeOf('zhihu.com')).toBe('forum');
    expect(sourceTypeOf('36kr.com')).toBe('news');
    expect(sourceTypeOf('example.com')).toBe('blog');
  });

  it('dedupeEvidence 按 URL 和内容指纹去重', () => {
    const rows = [
      ref('https://a.com/1', '同一篇'),
      ref('https://a.com/1?utm_source=x', '同一篇'),
      ref('https://b.com/1', '同一篇'),
      ref('https://c.com/1', '另一篇')
    ];
    expect(dedupeEvidence(rows).map((item) => item.url)).toEqual(['https://a.com/1', 'https://c.com/1']);
  });

  it('capPerDomain 每个域名最多两条', () => {
    const rows = [1, 2, 3].map((n) => ref(`https://a.com/${n}`, `第 ${n} 篇`));
    expect(capPerDomain(rows, 2)).toHaveLength(2);
  });

  it('rankEvidence 优先有正文和一手来源', () => {
    const rows = [
      ref('https://blog.example.com/post', '普通博客', { snippet: 'Whisper 中文' }),
      ref('https://github.com/x/y', '官方仓库', { snippet: 'Whisper 中文', content: '正文' })
    ];
    expect(rankEvidence(rows, ['Whisper 中文'])[0].url).toContain('github.com');
  });
});

describe('searchWebPlan', () => {
  beforeEach(() => {
    state.calls = [];
    state.rows = [];
  });

  it('多查询合并、去重并分配引用 id', async () => {
    state.rows = [
      ref('https://github.com/a/b', 'Repo A', { content: '正文' }),
      ref('https://example.com/x', 'Blog X', { date: '2026-01-01' })
    ];
    const result = await searchWebPlan(
      settings(),
      [
        { query: 'q1', angle: 'base' },
        { query: 'q2', angle: 'compare' }
      ],
      { read: 0 }
    );
    expect(state.calls).toEqual(['q1', 'q2']);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0].citeId).toMatch(/^[a-z0-9]+-1$/);
    expect(result.evidence.every((item) => item.site)).toBe(true);
    expect(result.meta.raw).toBe(4);
    expect(result.meta.deduped).toBe(2);
    expect(result.meta.queries).toEqual(['q1', 'q2']);
  });

  it('全部查询失败时记录 failures，不抛错', async () => {
    const spy = vi.mocked((await import('../search')).runProviderSearch);
    spy.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom2'));
    const result = await searchWebPlan(
      settings(),
      [
        { query: 'q1', angle: 'base' },
        { query: 'q2', angle: 'compare' }
      ],
      { read: 0 }
    );
    expect(result.evidence).toHaveLength(0);
    expect(result.meta.failures).toHaveLength(2);
  });
});
