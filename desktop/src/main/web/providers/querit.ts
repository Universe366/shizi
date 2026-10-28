import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { jsonOf, keyOf, parseRows, timeoutFetch } from './shared';

export async function searchQuerit(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const base = (platform.baseUrl || 'https://api.querit.ai/v1/search').replace(/\/+$/, '');
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Querit 需要 API Key');
  const response = await timeoutFetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      query,
      count: Math.min(100, Math.max(1, settings.search.maxResults || 5)),
      needContent: settings.search.includeContent !== false,
      highlights: true,
      ...(settings.search.snippetMode === 'none'
        ? {}
        : { contentMaxChars: Math.max(200, settings.search.snippetChars || 2000) })
    })
  });
  const data = await jsonOf(response, 'Querit');
  const nested = data.results as { result?: unknown[] } | undefined;
  const rows = Array.isArray(nested?.result) ? nested.result : [];
  return parseRows({ results: rows }, (item) => ({
    title: item.title,
    url: item.url,
    snippet: String(
      (Array.isArray(item.highlights) ? item.highlights.join(' ') : '') ||
        item.snippet ||
        item.content ||
        ''
    )
  }));
}
