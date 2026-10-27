import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchMetaso(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('秘塔搜索需要 API Key');
  const res = await timeoutFetch(platform.baseUrl || 'https://metaso.cn/api/v1/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      q: query,
      scope: 'webpage',
      includeSummary: settings.search.includeContent,
      size: String(Math.min(50, settings.search.maxResults)),
      ...(settings.search.timeRange !== 'any' ? { timeRange: settings.search.timeRange } : {})
    })
  });
  const data = await jsonOf(res, '秘塔搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.snippet || item.summary
  }));
}
