import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows, daysFor, isoDaysAgo } from './shared';

export async function searchDeepSeek(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('DeepSeek 搜索需要 Key（可复用 AI 平台 DeepSeek Key）');
  const base = platform.baseUrl.replace(/\/+$/, '');
  const url = /\/tools\/search$/.test(base) ? base : `${base}/tools/search`;
  const days = daysFor(settings.search.timeRange);
  const suffix = days ? ` after:${isoDaysAgo(days)}` : '';
  const payload = {
    query: `${query}${suffix}`.slice(0, 128),
    count: Math.min(50, settings.search.maxResults),
    need_content: settings.search.includeContent
  };
  const res = await timeoutFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });
  const data = await jsonOf(res, 'DeepSeek 搜索');
  return parseRows(data, (item) => ({
    title: item.title || item.url,
    url: item.url,
    snippet: item.summary || item.snippet || item.content
  }));
}
