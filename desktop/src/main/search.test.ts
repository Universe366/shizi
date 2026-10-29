import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from 'electron';
import type { AppSettings } from '../shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/shizi-search-test' },
  session: { defaultSession: { fetch: vi.fn() } }
}));

import {
  buildChatQuery,
  parseAutoSearchIntent,
  prepareResults,
  searchWeb,
  shouldAutoSearch,
  testSearch,
  withSearchSignal
} from './search';

const fetchMock = vi.mocked(session.defaultSession.fetch);
beforeEach(() => fetchMock.mockReset());

function searchSettings(): AppSettings {
  return {
    search: {
      enabled: true,
      activeId: 'exa',
      platforms: [
        {
          id: 'exa',
          name: 'Exa',
          kind: 'exa',
          baseUrl: '',
          apiKey: ''
        }
      ],
      maxResults: 3,
      includeContent: false,
      timeRange: 'any',
      verify: false,
      keylessFallback: false,
      keylessOrder: [],
      cacheMinutes: 0,
      autoSearchOnChat: false,
      alwaysSearchOnChat: false,
      useVideoMeta: true,
      useComments: true
    }
  } as unknown as AppSettings;
}

describe('搜索结果压缩', () => {
  it('截断模式限制字符数，不压缩模式保留完整摘要', async () => {
    const settings = searchSettings();
    settings.search.snippetChars = 200;
    settings.search.snippetMode = 'truncate';
    const rows = [{ title: '标题', url: 'https://example.com/a', snippet: 'x'.repeat(400) }];
    const truncated = await prepareResults(rows, settings, 3);
    expect(truncated[0].snippet).toHaveLength(200);

    settings.search.snippetMode = 'none';
    const full = await prepareResults(rows, settings, 3);
    expect(full[0].snippet).toHaveLength(400);
  });
});

describe('parseAutoSearchIntent', () => {
  it('解析 YES/NO 与中文', () => {
    expect(parseAutoSearchIntent('YES')).toBe(true);
    expect(parseAutoSearchIntent('需要')).toBe(true);
    expect(parseAutoSearchIntent('NO')).toBe(false);
    expect(parseAutoSearchIntent('不需要')).toBe(false);
  });

  it('无法判断时返回 null 交给规则', () => {
    expect(parseAutoSearchIntent('可能吧')).toBeNull();
    expect(parseAutoSearchIntent('')).toBeNull();
  });
});

describe('shouldAutoSearch', () => {
  it('明确要外部事实时触发', () => {
    expect(shouldAutoSearch('RTX 5090 现在多少钱')).toBe(true);
    expect(shouldAutoSearch('DeepSeek V4 什么时候发布')).toBe(true);
    expect(shouldAutoSearch('今天有什么新闻')).toBe(true);
  });

  it('字幕/总结类问题不自动联网', () => {
    expect(shouldAutoSearch('总结一下这期视频')).toBe(false);
    expect(shouldAutoSearch('解释一下刚才那句话')).toBe(false);
    expect(shouldAutoSearch('最近这期视频讲了什么')).toBe(false);
  });

  it('视频问题里带明确外部事实词仍然联网', () => {
    expect(shouldAutoSearch('这期视频里说的 RTX 5090 价格是多少')).toBe(true);
  });
});

describe('buildChatQuery', () => {
  const info = { title: 'DeepSeek V4 深度解析｜B站' };

  it('去掉「帮我查一下/联网」这类口令', () => {
    expect(buildChatQuery('帮我查一下 RTX 5090 价格')).toBe('RTX 5090 价格');
    expect(buildChatQuery('联网搜索 DeepSeek V4 发布时间')).toBe('DeepSeek V4 发布时间');
  });

  it('具体问题保持原样（只去问号）', () => {
    expect(buildChatQuery('今天有什么新闻？')).toBe('今天有什么新闻');
  });

  it('「这个视频/它」补上当前标题', () => {
    expect(buildChatQuery('这个视频说的对吗', info)).toContain('DeepSeek V4');
    expect(buildChatQuery('它靠谱吗', info)).toContain('DeepSeek V4');
  });

  it('多轮追问会带上上一问的检索词', () => {
    expect(buildChatQuery('那 4090 呢', info, 'RTX 5090 多少钱')).toContain('RTX 5090');
    expect(buildChatQuery('为什么', info, 'RTX 5090 多少钱')).toContain('RTX 5090');
    expect(buildChatQuery('这个视频说的对吗', info, 'RTX 5090 多少钱')).not.toContain('RTX 5090');
  });

  it('泛化问题 / 空问题用标题兜底', () => {
    expect(buildChatQuery('总结一下', info)).toBe('DeepSeek V4 深度解析');
    expect(buildChatQuery('', info)).toBe('DeepSeek V4 深度解析');
  });

  it('没有标题时至少给一个可检索词', () => {
    expect(buildChatQuery('')).toBe('最新');
  });
});

describe('检索引擎元信息', () => {
  it('返回实际引擎名，缓存命中时标注 cached', async () => {
    const settings = searchSettings();
    settings.search.platforms = [
      {
        id: 'custom-meta',
        name: '我的搜索',
        kind: 'custom',
        baseUrl: 'https://example.com/search',
        apiKey: ''
      }
    ];
    settings.search.activeId = 'custom-meta';
    settings.search.cacheMinutes = 5;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [{ title: '结果 A', url: 'https://example.com/a', snippet: '摘要' }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ) as never
    );
    const metas: unknown[] = [];
    const first = await searchWeb(settings, '唯一查询', (meta) => metas.push(meta));
    expect(first).toHaveLength(1);
    expect(metas[0]).toMatchObject({ engine: '我的搜索', fallback: false, cached: false });

    const second = await searchWeb(settings, '唯一查询', (meta) => metas.push(meta));
    expect(second).toHaveLength(1);
    expect(metas[1]).toMatchObject({ engine: '我的搜索', fallback: false, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('联网检索取消', () => {
  it('测试检索不会静默走免 Key 兜底', async () => {
    fetchMock.mockReset();
    const settings = searchSettings();
    settings.search.platforms = [
      {
        id: 'tavily',
        name: 'Tavily',
        kind: 'tavily',
        baseUrl: 'https://api.tavily.com/search',
        apiKey: ''
      }
    ];
    settings.search.activeId = 'tavily';
    settings.search.keylessFallback = true;
    await expect(testSearch(settings, 'DeepSeek V4')).rejects.toThrow('Tavily 需要 API Key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('已取消的 signal 不会再发请求', async () => {
    fetchMock.mockReset();
    const controller = new AbortController();
    controller.abort();
    await expect(
      withSearchSignal(controller.signal, () => testSearch(searchSettings(), 'DeepSeek V4'))
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('检索中途取消会 abort 底层 HTTP', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(((...args: unknown[]) => {
      const init = args[1] as RequestInit | undefined;
      const signal = init?.signal as AbortSignal | undefined;
      // 无 init 的调用来自测试框架内部清理，给一个空响应即可。
      if (!signal) return Promise.resolve(new Response('{}', { status: 200 }));
      return new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    }) as never);

    const controller = new AbortController();
    const pending = withSearchSignal(controller.signal, () =>
      testSearch(searchSettings(), 'DeepSeek V4')
    );
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
