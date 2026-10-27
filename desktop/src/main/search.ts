import { AsyncLocalStorage } from 'node:async_hooks';
import { session } from 'electron';
import type { AppSettings, SearchPlatform, SearchTimeRange, WebReference } from '../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 让取消信号沿着异步调用链传进每个 provider，而不必给 13 个搜索函数都加参数。
const searchSignal = new AsyncLocalStorage<AbortSignal | undefined>();

export function withSearchSignal<T>(
  signal: AbortSignal | undefined,
  task: () => Promise<T>
): Promise<T> {
  return signal ? searchSignal.run(signal, task) : task();
}

function cleanTitle(title: string): string {
  return String(title || '')
    .replace(/_哔哩哔哩.*$/i, '')
    .replace(/[|｜]\s*B站.*$/i, '')
    .replace(/【.*?】/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchQuery(title: string, owner?: string): string {  const clean = cleanTitle(title);
  if (clean.length >= 6) return clean;
  return [owner, clean].filter(Boolean).join(' ').trim() || clean || '视频';
}

/** 对话自动联网的轻量判断：只覆盖明显需要外部事实的问题，设置里默认关闭。 */
const AUTO_SEARCH_PATTERN =
  /最新|今天|现在|今年|近期|最近|谁|多少|多少钱|价格|售价|参数|配置|对比|区别|评测|推荐|值得|真假|谣言|核实|查证|查一下|搜索|什么时候|哪一年|发布|上市|新闻|版本|趋势|latest|news|price|who|when|current|today|compare/i;

export function shouldAutoSearch(question: string): boolean {
  const text = String(question || '');
  // 纯字幕/视频内容问题不该因为“最近/这期”就去搜网页；带明确外部事实词才放行。
  if (
    /视频|字幕|这期|本期|页面/.test(text) &&
    !/最新|新闻|发布|上市|价格|售价|参数|配置|对比|评测|谣言|真假/.test(text)
  ) {
    return false;
  }
  return AUTO_SEARCH_PATTERN.test(text);
}

/** 解析「是否需要联网」的小模型输出；无法判断时返回 null，交给规则兜底。 */
export function parseAutoSearchIntent(text: string): boolean | null {
  const value = String(text || '')
    .trim()
    .toLowerCase();
  if (/^(yes|y|是|需要|要)/.test(value)) return true;
  if (/^(no|n|否|不需要|不用)/.test(value)) return false;
  return null;
}

/**
 * 对话联网的检索词：把「帮我查一下」「联网」这类口令和口语尾巴去掉；
 * 用户说「这个视频/它」时补上当前标题，避免拿一句“总结一下”去搜。
 */
function stripChatPrefix(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /^(?:(?:请帮我|帮我|麻烦|请|能否|可以|我想|想问|问一下|请问|查一下|查查|查询|搜索一下|搜索|搜一下|搜搜|联网|上网|找一下|找找)[\s，,]*)+/,
      ''
    )
    .replace(/[？?。！!]+$/g, '')
    .trim();
}

export function buildChatQuery(
  question: string,
  info?: { title?: string; partTitle?: string },
  previousQuestion?: string
): string {
  const raw = String(question || '')
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = stripChatPrefix(raw);
  const previous = stripChatPrefix(previousQuestion || '');
  const followUp =
    Boolean(previous) &&
    stripped.length <= 14 &&
    !/视频|页面|本期/.test(stripped) &&
    /^(那|那么|还有|然后|具体|它|为什么|怎么|多久|多少|价格|多少钱|呢)/.test(stripped);
  if (followUp) {
    return `${previous.slice(0, 40)} ${stripped}`.trim().slice(0, 80);
  }
  const title = cleanTitle(info?.title || '');
  const meta = /^(总结一下|总结|解释一下|解释|说说|讲讲|介绍一下|介绍|怎么回事|为什么|有用吗|对吗)$/.test(
    stripped
  );
  const vague = !stripped || stripped.length < 4 || meta;
  const refers = /这个|该视频|本期|视频里|前面|刚才|上面|它/.test(raw);
  if ((vague || refers) && title) {
    const core = meta || !stripped || stripped === title ? '' : ` ${stripped}`;
    return `${title}${core}`.slice(0, 80);
  }
  return (stripped || title || '最新').slice(0, 80);
}

function daysFor(range: SearchTimeRange): number | undefined {
  if (range === 'year') return 365;
  if (range === 'month') return 30;
  if (range === 'week') return 7;
  return undefined;
}

function freshnessFor(range: SearchTimeRange): string {
  if (range === 'year') return 'py';
  if (range === 'month') return 'pm';
  if (range === 'week') return 'pw';
  return '';
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function timeoutFetch(
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

function normalize(rows: WebReference[], max: number): WebReference[] {
  const out: WebReference[] = [];
  const seen = new Set<string>();
  const plain = (value: unknown): string =>
    String(value || '')
      // 搜索接口常在标题/摘要里塞 <b> 高亮，UI 和模型都不需要这些标签。
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  for (const row of rows) {
    const url = String(row.url || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({
      ...row,
      title: plain(row.title) || url,
      url,
      snippet: plain(row.snippet)
    });
    if (out.length >= max) break;
  }
  return out;
}

export interface SearchMeta {
  /** 实际使用的引擎名（可能带“免费兜底”） */
  engine: string;
  fallback: boolean;
  cached: boolean;
}

const searchCache = new Map<string, { at: number; refs: WebReference[]; meta: SearchMeta }>();
const SEARCH_CACHE_MAX = 120;

function rememberSearch(key: string, refs: WebReference[], meta: SearchMeta): void {
  searchCache.set(key, { at: Date.now(), refs, meta });
  if (searchCache.size <= SEARCH_CACHE_MAX) return;
  // 长期运行的桌面端不能无限攒检索结果：按时间淘汰最旧的一批。
  const oldest = [...searchCache.entries()]
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, searchCache.size - SEARCH_CACHE_MAX);
  for (const [oldKey] of oldest) searchCache.delete(oldKey);
}

function emitMeta(callback: ((meta: SearchMeta) => void) | undefined, meta: SearchMeta): void {
  try {
    callback?.(meta);
  } catch {
    // 状态回调失败不影响检索
  }
}

function activePlatform(settings: AppSettings): SearchPlatform {
  return (
    settings.search.platforms.find((item) => item.id === settings.search.activeId) ||
    settings.search.platforms[0]
  );
}

function keyOf(settings: AppSettings, platform: SearchPlatform): string {
  const direct = String(platform.apiKey || '').trim();
  if (direct) return direct;
  if (platform.reuseAiKey) {
    return (
      settings.ai.platforms.find((item) => item.id === platform.reuseAiKey)?.apiKey || ''
    ).trim();
  }
  return '';
}

interface SearchRow {
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

interface SearchPayload {
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

function parseRows(
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

async function jsonOf(res: Response, label: string): Promise<SearchPayload> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} HTTP ${res.status}：${text.slice(0, 160)}`);
  }
  return (await res.json()) as SearchPayload;
}

async function searchDeepSeek(
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

async function searchTavily(
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

async function searchBocha(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('博查 Bocha 需要 API Key');
  const body: Record<string, unknown> = {
    query,
    count: settings.search.maxResults,
    summary: settings.search.includeContent
  };
  if (settings.search.timeRange !== 'any') {
    body.freshness =
      settings.search.timeRange === 'year'
        ? 'oneYear'
        : settings.search.timeRange === 'month'
          ? 'oneMonth'
          : 'oneWeek';
  }
  const res = await timeoutFetch(platform.baseUrl || 'https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
  const data = await jsonOf(res, 'Bocha');
  return parseRows(data, (item) => ({
    title: item.name || item.title,
    url: item.url,
    snippet: item.summary || item.snippet
  }));
}

async function searchSerper(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Serper 需要 API Key');
  const tbs =
    settings.search.timeRange === 'year'
      ? 'qdr:y'
      : settings.search.timeRange === 'month'
        ? 'qdr:m'
        : settings.search.timeRange === 'week'
          ? 'qdr:w'
          : '';
  const res = await timeoutFetch(platform.baseUrl || 'https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': key
    },
    body: JSON.stringify({
      q: query,
      num: settings.search.maxResults,
      ...(tbs ? { tbs } : {})
    })
  });
  const data = await jsonOf(res, 'Serper');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.snippet
  }));
}

async function searchZhipu(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('智谱 Web 搜索需要 API Key');
  const body: Record<string, unknown> = {
    search_engine: 'search_std',
    search_query: query,
    count: Math.min(50, settings.search.maxResults),
    content_size: settings.search.includeContent ? 'high' : 'medium'
  };
  if (settings.search.timeRange !== 'any') {
    body.search_recency_filter =
      settings.search.timeRange === 'year'
        ? 'oneYear'
        : settings.search.timeRange === 'month'
          ? 'oneMonth'
          : 'oneWeek';
  }
  const res = await timeoutFetch(
    platform.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/web_search',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    }
  );
  const data = await jsonOf(res, '智谱搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.content || item.snippet
  }));
}

async function searchMetaso(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('秘塔搜索需要 API Key');
  const res = await timeoutFetch(platform.baseUrl || 'https://metaso.cn/api/v1/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      q: query,
      scope: 'webpage',
      includeSummary: settings.search.includeContent,
      size: String(Math.min(50, settings.search.maxResults)),
      ...(settings.search.timeRange !== 'any' ? { timeRange: settings.search.timeRange } : {})
    })
  });
  const data = await jsonOf(res, '秘塔搜索');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.link || item.url,
    snippet: item.snippet || item.summary
  }));
}

async function searchBaidu(
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

async function searchBrave(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const key = keyOf(settings, platform);
  if (!key) throw new Error('Brave 需要 API Key');
  const url = new URL(platform.baseUrl || 'https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(20, settings.search.maxResults)));
  const freshness = freshnessFor(settings.search.timeRange);
  if (freshness) url.searchParams.set('freshness', freshness);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      'x-subscription-token': key,
      'user-agent': UA
    }
  });
  const data = await jsonOf(res, 'Brave');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.description
  }));
}

interface RpcPayload {
  result?: { content?: Array<{ text?: string }> };
  error?: unknown;
}

function parseRpcPayload(raw: string): RpcPayload | null {
  const text = String(raw || '').trim();
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text) as RpcPayload;
    } catch {
      // 继续按 SSE 解析
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload) as RpcPayload;
      if (json && (json.result || json.error)) return json;
    } catch {
      // ignore
    }
  }
  return null;
}

function parseExaText(text: string): WebReference[] {
  const rows: WebReference[] = [];
  for (const chunk of String(text || '').split(/\n(?=Title:)/)) {
    const title = /^Title:\s*(.*)$/m.exec(chunk);
    const url = /^URL:\s*(\S+)/m.exec(chunk);
    if (!title || !url) continue;
    let body = chunk;
    const highlights = chunk.indexOf('Highlights:');
    if (highlights >= 0) body = chunk.slice(highlights + 'Highlights:'.length);
    rows.push({
      title: title[1].trim(),
      url: url[1].trim(),
      snippet: body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000)
    });
  }
  return rows;
}

async function searchExa(query: string, settings: AppSettings): Promise<WebReference[]> {
  const endpoint = 'https://mcp.exa.ai/mcp';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  const init = await timeoutFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'shizi', version: '1' }
      }
    })
  });
  if (!init.ok) throw new Error(`Exa 握手 HTTP ${init.status}`);
  const sessionId = init.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;
  await init.text().catch(() => '');
  await timeoutFetch(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    10000
  ).catch(() => undefined);

  const call = await timeoutFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query,
          numResults: Math.min(10, settings.search.maxResults)
        }
      }
    })
  });
  if (!call.ok) throw new Error(`Exa 调用 HTTP ${call.status}`);
  const json = parseRpcPayload(await call.text());
  const content = json?.result?.content;
  const text = Array.isArray(content)
    ? content
        .map((item) => item?.text || '')
        .filter(Boolean)
        .join('\n')
    : '';
  const rows = parseExaText(text);
  if (!rows.length) throw new Error('Exa 未返回可解析结果');
  return rows;
}

async function searchAnySearch(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const res = await timeoutFetch(platform.baseUrl || 'https://api.anysearch.com/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query, max_results: settings.search.maxResults })
  });
  const data = await jsonOf(res, 'AnySearch');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url || item.link,
    snippet: item.snippet || item.content
  }));
}

async function searchJina(
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

async function searchSearxng(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const url = new URL(platform.baseUrl || 'https://searx.be/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  if (settings.search.timeRange !== 'any') {
    url.searchParams.set('time_range', settings.search.timeRange);
  }
  const key = keyOf(settings, platform);
  const res = await timeoutFetch(url.toString(), {
    headers: {
      accept: 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  });
  const data = await jsonOf(res, 'SearXNG');
  return parseRows(data, (item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content
  }));
}

async function searchCustom(
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

function compileBlacklist(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const raw of patterns || []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    try {
      if (text.startsWith('/') && text.lastIndexOf('/') > 0) {
        const end = text.lastIndexOf('/');
        const body = text.slice(1, end);
        const flags = text.slice(end + 1).replace(/[^gimsuy]/g, '');
        compiled.push(new RegExp(body, flags || 'i'));
        continue;
      }
      // ublacklist 风格：* 通配，其余字符按字面量处理
      const escaped = text
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      compiled.push(new RegExp(`^${escaped}$`, 'i'));
    } catch {
      // 非法正则忽略，避免一条坏规则让整个检索失败
    }
  }
  return compiled;
}

/** 判断结果是否命中黑名单（URL 整串匹配）。 */
export function isBlockedUrl(url: string, patterns: string[]): boolean {
  if (!patterns?.length) return false;
  return compileBlacklist(patterns).some((pattern) => pattern.test(String(url || '')));
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
  };
  return text
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

/** 极简正文提取：丢掉脚本/样式，按块级标签换行。够做证据补充，不做完整 readability。 */
export function htmlToText(html: string): string {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export async function fetchPageText(url: string, maxChars: number): Promise<string> {
  if (!/^https?:/i.test(url)) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const outer = searchSignal.getStore();
  const forward = () => controller.abort();
  outer?.addEventListener('abort', forward, { once: true });
  try {
    const response = await session.defaultSession.fetch(url, {
      method: 'GET',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal
    });
    if (!response.ok) return '';
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|text\/plain/i.test(type)) return '';
    const html = (await response.text()).slice(0, 400000);
    return htmlToText(html).slice(0, maxChars);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
}

/** 抓取前几条结果的正文，替换默认摘要（失败时保留原摘要）。 */
async function enrichWithPages(
  refs: WebReference[],
  maxChars: number,
  limit = 3
): Promise<WebReference[]> {
  const targets = refs.slice(0, limit);
  if (!targets.length) return refs;
  const texts = await Promise.all(targets.map((ref) => fetchPageText(ref.url, maxChars)));
  return refs.map((ref, index) => {
    const text = texts[index];
    if (index < limit && text && text.length > 80) {
      return { ...ref, snippet: text };
    }
    return ref;
  });
}

/** 统一做黑名单过滤、截断与正文抓取（主引擎和免费兜底共用）。 */
export async function prepareResults(
  rows: WebReference[],
  settings: AppSettings,
  max: number
): Promise<WebReference[]> {
  const maxChars = Math.max(200, settings.search.snippetChars || 2000);
  let normalized = normalize(rows, max).filter(
    (ref) => !isBlockedUrl(ref.url, settings.search.blacklist || [])
  );
  normalized = normalized.map((ref) => ({
    ...ref,
    snippet: String(ref.snippet || '').slice(0, maxChars)
  }));
  if (settings.search.fetchPages && normalized.length) {
    normalized = await enrichWithPages(normalized, maxChars, 3);
  }
  return normalized;
}

/** 按 platform.kind 调度到具体 provider：检索层唯一入口。 */
export async function runProviderSearch(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  const kind = platform.kind || 'custom';
  if (kind === 'deepseek-search') return searchDeepSeek(settings, platform, query);
  if (kind === 'tavily') return searchTavily(settings, platform, query);
  if (kind === 'bocha') return searchBocha(settings, platform, query);
  if (kind === 'serper') return searchSerper(settings, platform, query);
  if (kind === 'zhipu') return searchZhipu(settings, platform, query);
  if (kind === 'metaso') return searchMetaso(settings, platform, query);
  if (kind === 'baidu') return searchBaidu(settings, platform, query);
  if (kind === 'brave') return searchBrave(settings, platform, query);
  if (kind === 'exa') return searchExa(query, settings);
  if (kind === 'anysearch') return searchAnySearch(settings, platform, query);
  if (kind === 'jina') return searchJina(settings, platform, query);
  if (kind === 'searxng') return searchSearxng(settings, platform, query);
  return searchCustom(settings, platform, query);
}

export async function searchWeb(
  settings: AppSettings,
  query: string,
  onMeta?: (meta: SearchMeta) => void
): Promise<WebReference[]> {  if (!settings.search.enabled) return [];
  const abort = searchSignal.getStore();
  if (abort?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
  const platform = activePlatform(settings);
  if (!platform) throw new Error('没有可用的检索平台');
  const max = settings.search.maxResults;
  const kind = platform.kind || 'custom';
  if (!platform.baseUrl.trim() && (kind === 'deepseek-search' || kind === 'custom')) {
    throw new Error(`${platform.name || '检索平台'} 还没有填写接口地址`);
  }
  const cacheKey = `${platform.id}|${platform.kind || ''}|${platform.baseUrl || ''}|${query}|${max}|${settings.search.timeRange}|${settings.search.includeContent ? 1 : 0}|${settings.search.fetchPages ? 1 : 0}|${settings.search.snippetChars || 2000}|${(settings.search.blacklist || []).join(',')}`;
  const ttl = Math.max(0, settings.search.cacheMinutes || 0) * 60000;
  if (ttl > 0) {
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ttl) {
      emitMeta(onMeta, { ...cached.meta, cached: true });
      return cached.refs.map((ref) => ({ ...ref }));
    }
  }

  try {
    const rows = await runProviderSearch(settings, platform, query);
    const normalized = await prepareResults(rows, settings, max);
    if (normalized.length) {
      const meta: SearchMeta = {
        engine: platform.name || platform.kind || '检索',
        fallback: false,
        cached: false
      };
      if (ttl > 0) rememberSearch(cacheKey, normalized, meta);
      emitMeta(onMeta, meta);
      return normalized;
    }
    throw new Error('没有返回结果');
  } catch (error) {
    // 用户取消/超时后不要再换引擎重试。
    if (searchSignal.getStore()?.aborted) throw error;
    if (settings.search.keylessFallback !== false) {
      // 无 Key 兜底：按用户配置的顺序逐个尝试（exa / anysearch / searxng）。
      const order =
        Array.isArray(settings.search.keylessOrder) && settings.search.keylessOrder.length
          ? settings.search.keylessOrder
          : ['exa', 'anysearch'];
      for (const id of order) {
        if (searchSignal.getStore()?.aborted) throw error;
        if (id === kind) continue;
        try {
          let rows: WebReference[] = [];
          if (id === 'exa') rows = await searchExa(query, settings);
          else if (id === 'anysearch')
            rows = await searchAnySearch(settings, freePlatform('anysearch'), query);
          else if (id === 'searxng')
            rows = await searchSearxng(settings, freePlatform('searxng'), query);
          const fallback = await prepareResults(rows, settings, max);
          if (fallback.length) {
            const meta: SearchMeta = {
              engine:
                id === 'exa'
                  ? 'Exa（免费兜底）'
                  : id === 'anysearch'
                    ? 'AnySearch（免费兜底）'
                    : 'SearXNG（免费兜底）',
              fallback: true,
              cached: false
            };
            if (ttl > 0) rememberSearch(cacheKey, fallback, meta);
            emitMeta(onMeta, meta);
            return fallback;
          }
        } catch {
          // 继续尝试下一个免费引擎
        }
      }
    }
    throw new Error(`检索失败（${platform.name}）：${(error as Error).message}`, { cause: error });
  }
}

function queryTerms(query: string): string[] {
  const text = String(query || '').toLowerCase();
  const terms = new Set<string>();
  for (const word of text.match(/[a-z0-9][a-z0-9._-]{2,}/g) || []) terms.add(word);
  const cjk = text.match(/[㐀-鿿]+/g) || [];
  for (const run of cjk) {
    if (run.length === 1) terms.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
  }
  return [...terms];
}

export function rankReferences(query: string, references: WebReference[]): WebReference[] {
  const terms = queryTerms(query);
  if (!terms.length) return references;
  const scored = references.map((reference, index) => {
    const title = reference.title.toLowerCase();
    const snippet = reference.snippet.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 3;
      if (snippet.includes(term)) score += 1;
    }
    if (title.includes(query.toLowerCase())) score += 5;
    return { reference, score, index };
  });
  const positive = scored.filter((item) => item.score > 0);
  if (!positive.length) return references;
  return positive
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.reference);
}

export async function testSearch(settings: AppSettings, query: string): Promise<WebReference[]> {
  // 设置页的「测试」必须只测当前平台：不能让免 Key 兜底把错误配置伪装成成功。
  const enabled = {
    ...settings,
    search: {
      ...settings.search,
      enabled: true,
      keylessFallback: false,
      cacheMinutes: 0
    }
  };
  return searchWeb(enabled, query);
}
