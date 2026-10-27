import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { timeoutFetch, keyOf, jsonOf, parseRows } from './shared';

export async function searchBaidu(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('百度千帆 AI 搜索需要 API Key');
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: query }],
    search_source: 'baidu_search_v2',
    resource_type_filter: [{ type: 'web', top_k: settings.search.maxResults }]
  };
  if (settings.search.timeRange !== 'any') {
    body.search_recency_filter = settings.search.timeRange;
  }
  const res = await timeoutFetch(
    platform.baseUrl || 'https://qianfan.baidubce.com/v2/ai_search/web_search',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    }
  );
  const data = await jsonOf(res, '百度 AI 搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.content || item.snippet
  }));
}
