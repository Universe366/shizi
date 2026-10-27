import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchBocha(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('博查 Bocha 需要 API Key');
  const body: Record<string, unknown> = {
    query,
    count: settings.search.maxResults,
    summary: settings.search.includeContent
  };
  if (settings.search.timeRange !== 'any') {
    body.freshness =
      settings.search.timeRange === 'year'
        ? 'oneYear'
        : settings.search.timeRange === 'month'
          ? 'oneMonth'
          : 'oneWeek';
  }
  const res = await timeoutFetch(platform.baseUrl || 'https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
  const data = await jsonOf(res, 'Bocha');
  return parseRows(data, (item) => ({
    title: item.name || item.title,
    url: item.url,
    snippet: item.summary || item.snippet
  }));
}
