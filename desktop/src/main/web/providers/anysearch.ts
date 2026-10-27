import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, jsonOf, parseRows, UA } from './shared';

export async function searchAnySearch(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const res = await timeoutFetch(platform.baseUrl || 'https://api.anysearch.com/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query, max_results: settings.search.maxResults })
  });
  const data = await jsonOf(res, 'AnySearch');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.snippet || item.content
  }));
}
