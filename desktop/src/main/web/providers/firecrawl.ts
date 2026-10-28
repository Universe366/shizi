import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { jsonOf, keyOf, parseRows, timeoutFetch } from './shared';

export async function searchFirecrawl(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const base = (platform.baseUrl || 'https://api.firecrawl.dev/v1/search').replace(/\/+$/, '');
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Firecrawl 需要 API Key');
  const response = await timeoutFetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      query,
      limit: Math.min(100, Math.max(1, settings.search.maxResults || 5))
    })
  });
  const data = await jsonOf(response, 'Firecrawl');
  return parseRows(data, (item) => ({
    title: item.title || item.name,
    url: item.url || item.link,
    snippet: String(item.markdown || item.description || item.content || item.snippet || '')
  }));
}
