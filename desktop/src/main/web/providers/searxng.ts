import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchSearxng(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const url = new URL(platform.baseUrl || 'https://searx.be/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  if (settings.search.timeRange !== 'any') {
    url.searchParams.set('time_range', settings.search.timeRange);
  }
  const key = keyOf(settings, platform);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  });
  const data = await jsonOf(res, 'SearXNG');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content
  }));
}
