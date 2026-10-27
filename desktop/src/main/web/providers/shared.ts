import { AsyncLocalStorage } from 'node:async_hooks';
import { session } from 'electron';
import type { AppSettings, SearchPlatform, SearchTimeRange, WebReference } from '../../../shared/types';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 让取消信号沿着异步调用链传进每个 provider，而不必给 13 个搜索函数都加参数。
export const searchSignal = new AsyncLocalStorage<AbortSignal | undefined>();

export function withSearchSignal<T>(
  signal: AbortSignal | undefined,
  task: () => Promise<T>
): Promise<T> {
  return signal ? searchSignal.run(signal, task) : task();
}

export function daysFor(range: SearchTimeRange): number | undefined {
  if (range === 'year') return 365;
  if (range === 'month') return 30;
  if (range === 'week') return 7;
  return undefined;
}

export function freshnessFor(range: SearchTimeRange): string {
  if (range === 'year') return 'py';
  if (range === 'month') return 'pm';
  if (range === 'week') return 'pw';
  return '';
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export async function timeoutFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 20000,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const outer = signal || searchSignal.getStore();
  const forwardAbort = () => controller.abort(outer?.reason);
  outer?.addEventListener('abort', forwardAbort, { once: true });
  if (outer?.aborted) controller.abort(outer.reason);
  const timer = setTimeout(() => controller.abort(new Error('检索超时')), timeoutMs);
  try {
    return await session.defaultSession.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forwardAbort);
  }
}

export function keyOf(settings: AppSettings, platform: SearchPlatform): string {
  const direct = String(platform.apiKey || '').trim();
  if (direct) return direct;
  if (platform.reuseAiKey) {
    return (
      settings.ai.platforms.find((item) => item.id === platform.reuseAiKey)?.apiKey || ''
    ).trim();
  }
  return '';
}

export interface SearchRow {
  title?: string;
  url?: string;
  link?: string;
  snippet?: string;
  content?: string;
  description?: string;
  name?: string;
  body?: string;
  summary?: string;
  raw_content?: string;
  [key: string]: unknown;
}

export interface SearchPayload {
  results?: unknown[];
  data?:
    | (unknown[] & { results?: unknown[]; webPages?: { value?: unknown[] }; webpages?: unknown[] })
    | undefined;
  webPages?: { value?: unknown[] };
  organic?: unknown[];
  search_result?: unknown[];
  references?: unknown[];
  search_results?: unknown[];
  webpages?: unknown[];
  web?: { results?: unknown[] };
  items?: unknown[];
}

export function parseRows(
  data: SearchPayload,
  pick: (item: SearchRow) => { title?: string; url?: string; snippet?: string }
): WebReference[] {
  const candidates: unknown[] = [];
  if (Array.isArray(data?.results)) candidates.push(...data.results);
  if (Array.isArray(data?.data?.results)) candidates.push(...data.data.results);
  if (Array.isArray(data?.data?.webPages?.value)) candidates.push(...data.data.webPages.value);
  if (Array.isArray(data?.webPages?.value)) candidates.push(...data.webPages.value);
  if (Array.isArray(data?.organic)) candidates.push(...data.organic);
  if (Array.isArray(data?.search_result)) candidates.push(...data.search_result);
  if (Array.isArray(data?.references)) candidates.push(...data.references);
  if (Array.isArray(data?.search_results)) candidates.push(...data.search_results);
  if (Array.isArray(data?.data?.webpages)) candidates.push(...data.data.webpages);
  if (Array.isArray(data?.webpages)) candidates.push(...data.webpages);
  if (Array.isArray(data?.web?.results)) candidates.push(...data.web.results);
  if (
    Array.isArray(data?.data) &&
    data.data.some((item) => {
      const row = item as SearchRow;
      return Boolean(row?.url || row?.link);
    })
  ) {
    candidates.push(...data.data);
  }
  if (Array.isArray(data?.items)) candidates.push(...data.items);
  return candidates
    .map((item) => {
      const row = (item || {}) as SearchRow;
      const picked = pick(row) as WebReference;
      // 各家的元数据字段名不一致，统一在这里兜一层；provider 不返回就保持 undefined。
      const date =
        row.date ?? row.published_date ?? row.publish_time ?? row.datePublished ?? row.publishDate;
      const summary = row.summary;
      const content = row.content ?? row.raw_content;
      const authority = Number(row.authority);
      const rerank = Number(row.rerank_score ?? row.rerankScore);
      const extra: Partial<WebReference> = {};
      if (typeof date === 'string' && date.trim()) extra.date = date.trim();
      if (typeof summary === 'string' && summary.trim()) extra.summary = summary.trim();
      if (typeof content === 'string' && content.trim()) extra.content = content.trim();
      if (Number.isFinite(authority)) extra.authority = authority;
      if (Number.isFinite(rerank)) extra.rerank = rerank;
      return { ...picked, ...extra };
    })
    .filter((item): item is WebReference => Boolean(item && item.url)) as WebReference[];
}

export async function jsonOf(res: Response, label: string): Promise<SearchPayload> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} HTTP ${res.status}：${text.slice(0, 160)}`);
  }
  return (await res.json()) as SearchPayload;
}

export function freePlatform(id: 'anysearch' | 'searxng'): SearchPlatform {
  if (id === 'anysearch') {
    return {
      id: 'keyless-anysearch',
      name: 'AnySearch（免费兜底）',
      kind: 'anysearch',
      baseUrl: 'https://api.anysearch.com/v1/search',
      apiKey: ''
    };
  }
  return {
    id: 'keyless-searxng',
    name: 'SearXNG（公共实例）',
    kind: 'searxng',
    baseUrl: 'https://searx.be/search',
    apiKey: ''
  };
}
