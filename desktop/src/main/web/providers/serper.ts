import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchSerper(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Serper 需要 API Key');
  const tbs =
    settings.search.timeRange === 'year'
      ? 'qdr:y'
      : settings.search.timeRange === 'month'
        ? 'qdr:m'
        : settings.search.timeRange === 'week'
          ? 'qdr:w'
          : '';
  const res = await timeoutFetch(platform.baseUrl || 'https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': key
    },
    body: JSON.stringify({
      q: query,
      num: settings.search.maxResults,
      ...(tbs ? { tbs } : {})
    })
  });
  const data = await jsonOf(res, 'Serper');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.snippet
  }));
}
