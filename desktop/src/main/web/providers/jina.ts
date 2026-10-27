import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchJina(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const base = (platform.baseUrl || 'https://s.jina.ai/').replace(/\/+$/, '');
  const key = keyOf(settings, platform);
  const res = await timeoutFetch(`${base}/${encodeURIComponent(query)}`, {
    headers: {
      accept: 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  });
  const data = await jsonOf(res, 'Jina');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.description || item.content
  }));
}
