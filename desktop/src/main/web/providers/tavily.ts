import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchTavily(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Tavily 需要 API Key');
  const body: Record<string, unknown> = {
    api_key: key,
    query,
    max_results: settings.search.maxResults,
    include_answer: false,
    include_raw_content: settings.search.includeContent,
    search_depth: 'basic'
  };
  if (settings.search.timeRange !== 'any') body.time_range = settings.search.timeRange;
  const res = await timeoutFetch(platform.baseUrl || 'https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await jsonOf(res, 'Tavily');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content || item.raw_content || item.snippet
  }));
}
