import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { jsonOf, keyOf, parseRows, timeoutFetch } from './shared';

export async function searchExaApi(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const base = (platform.baseUrl || 'https://api.exa.ai/search').replace(/\/+$/, '');
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Exa API 需要 API Key');
  const response = await timeoutFetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key
    },
    body: JSON.stringify({
      query,
      numResults: Math.min(100, Math.max(1, settings.search.maxResults || 5)),
      contents: { text: { maxCharacters: Math.max(200, settings.search.snippetChars || 2000) } }
    })
  });
  const data = await jsonOf(response, 'Exa');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: String(
      item.text ||
        item.summary ||
        (Array.isArray(item.highlights) ? item.highlights.join(' ') : item.snippet) ||
        ''
    )
  }));
}
