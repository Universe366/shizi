import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchCustom(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  if (!platform.baseUrl.trim()) throw new Error('自定义搜索接口地址为空');
  const url = new URL(platform.baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(settings.search.maxResults));
  const key = keyOf(settings, platform);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  });
  const data = await jsonOf(res, '自定义搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.snippet || item.content
  }));
}
