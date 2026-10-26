/** 地址栏与起始页共用的搜索引擎清单。 */
export type SearchEngineId =
  | 'bilibili'
  | 'bing'
  | 'google'
  | 'baidu'
  | 'duckduckgo'
  | 'sogou'
  | 'so360'
  | 'yandex'
  | 'brave'
  | 'ecosia'
  | 'custom';

export interface SearchEngineDef {
  id: SearchEngineId;
  label: string;
  /** 不含 query 的前缀；custom 没有固定模板 */
  template?: string;
  hint?: string;
}

export const SEARCH_ENGINES: SearchEngineDef[] = [
  { id: 'bing', label: '必应', template: 'https://www.bing.com/search?q=' },
  { id: 'google', label: 'Google', template: 'https://www.google.com/search?q=' },
  { id: 'baidu', label: '百度', template: 'https://www.baidu.com/s?wd=' },
  { id: 'bilibili', label: 'B 站', template: 'https://search.bilibili.com/all?keyword=' },
  { id: 'duckduckgo', label: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=' },
  { id: 'sogou', label: '搜狗', template: 'https://www.sogou.com/web?query=' },
  { id: 'so360', label: '360 搜索', template: 'https://www.so.com/s?q=' },
  { id: 'yandex', label: 'Yandex', template: 'https://yandex.com/search/?text=' },
  { id: 'brave', label: 'Brave', template: 'https://search.brave.com/search?q=' },
  { id: 'ecosia', label: 'Ecosia', template: 'https://www.ecosia.org/search?q=' },
  { id: 'custom', label: '自定义', hint: '模板必须包含 {q}' }
];

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'bing';

export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return SEARCH_ENGINES.some((engine) => engine.id === value);
}

export function searchEngineLabel(id: string | undefined): string {
  return SEARCH_ENGINES.find((engine) => engine.id === id)?.label || '必应';
}

/** 把关键词拼成搜索 URL；custom 模板无效时回退必应。 */
export function buildSearchUrl(
  engine: SearchEngineId | string | undefined,
  query: string,
  customUrl = ''
): string {
  const encoded = encodeURIComponent(query);
  if (engine === 'custom') {
    const template = String(customUrl || '').trim();
    if (template.includes('{q}')) return template.replace('{q}', encoded);
    return `https://www.bing.com/search?q=${encoded}`;
  }
  const template =
    SEARCH_ENGINES.find((item) => item.id === engine)?.template ||
    'https://www.bing.com/search?q=';
  return `${template}${encoded}`;
}
