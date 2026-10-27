import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows, freshnessFor, UA } from './shared';

export async function searchBrave(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Brave 需要 API Key');
  const url = new URL(platform.baseUrl || 'https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(20, settings.search.maxResults)));
  const freshness = freshnessFor(settings.search.timeRange);
  if (freshness) url.searchParams.set('freshness', freshness);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      'x-subscription-token': key,
      'user-agent': UA
    }
  });
  const data = await jsonOf(res, 'Brave');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.description
  }));
}
