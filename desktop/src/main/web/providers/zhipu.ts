import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchZhipu(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('智谱 Web 搜索需要 API Key');
  const body: Record<string, unknown> = {
    search_engine: 'search_std',
    search_query: query,
    count: Math.min(50, settings.search.maxResults),
    content_size: settings.search.includeContent ? 'high' : 'medium'
  };
  if (settings.search.timeRange !== 'any') {
    body.search_recency_filter =
      settings.search.timeRange === 'year'
        ? 'oneYear'
        : settings.search.timeRange === 'month'
          ? 'oneMonth'
          : 'oneWeek';
  }
  const res = await timeoutFetch(
    platform.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/web_search',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    }
  );
  const data = await jsonOf(res, '智谱搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.content || item.snippet
  }));
}
