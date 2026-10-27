import type {
  AppSettings,
  SearchPlatform,
  WebReference
} from '../../shared/types';
import {
  fetchPageText,
  freePlatform,
  prepareResults,
  runProviderSearch,
  withSearchSignal
} from '../search';
import { cachedDocument, rememberDocument } from './documents';
import { recordSearch } from './metrics';
import type { SearchPlanItem } from './plan';

export interface WebSearchMeta {
  queries: string[];
  engine: string;
  fallback: boolean;
  cached: boolean;
  raw: number;
  deduped: number;
  fetched: number;
  elapsedMs: number;
  failures: string[];
}

export interface WebSearchResult {
  evidence: WebEvidence[];
  meta: WebSearchMeta;
}

export type WebEvidence = WebReference & { citeId: string; site: string };

interface CacheEntry {
  at: number;
  refs: WebReference[];
}

const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 200;

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function sourceTypeOf(site: string): NonNullable<WebReference['sourceType']> {
  const host = site.toLowerCase();
  if (/\.gov(\.|$)|\/|^gov\.|\.edu(\.|$)|^edu\./.test(host)) return 'official';
  if (/(^|\.)(github\.com|gitlab\.com|huggingface\.co|npmjs\.com|pypi\.org|gitee\.com|crates\.io)$/.test(host)) {
    return 'repo';
  }
  if (/(^|\.)(arxiv\.org|doi\.org|nature\.com|science\.org|ieee\.org|acm\.org|springer\.com|sciencedirect\.com)$/.test(host)) {
    return 'paper';
  }
  if (/(^|\.)(zhihu\.com|v2ex\.com|reddit\.com|stackoverflow\.com|bilibili\.com|tieba\.baidu\.com|weibo\.com)$/.test(host)) {
    return 'forum';
  }
  if (/(^|\.)(36kr\.com|ithome\.com|theverge\.com|techcrunch\.com|reuters\.com|bloomberg\.com|nytimes\.com|bbc\.com|xinhuanet\.com|people\.com\.cn|cnbeta\.com)$/.test(host)) {
    return 'news';
  }
  return host ? 'blog' : 'other';
}

/** URL 规范化：去掉 hash、utm 与尾部斜杠，避免同一页重复计数。 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_|^spm$|^from$/i.test(key)) parsed.searchParams.delete(key);
    }
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const query = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return String(url || '');
  }
}

/** 同 URL 或同标题/摘要指纹只保留第一条。 */
export function dedupeEvidence(refs: WebReference[]): WebReference[] {
  const seenUrl = new Set<string>();
  const seenText = new Set<string>();
  const out: WebReference[] = [];
  for (const ref of refs) {
    if (!ref?.url) continue;
    const urlKey = normalizeUrl(ref.url);
    const textKey = `${String(ref.title || '')
      .replace(/\s+/g, '')
      .toLowerCase()}|${String(ref.snippet || '')
      .replace(/\s+/g, '')
      .slice(0, 80)
      .toLowerCase()}`;
    if (seenUrl.has(urlKey) || seenText.has(textKey)) continue;
    seenUrl.add(urlKey);
    seenText.add(textKey);
    out.push(ref);
  }
  return out;
}

/** 每个域名最多保留 cap 条，避免单一站点刷屏。 */
export function capPerDomain(refs: WebReference[], cap = 2): WebReference[] {
  const counts = new Map<string, number>();
  return refs.filter((ref) => {
    const domain = siteOf(ref.url);
    const used = counts.get(domain) || 0;
    if (used >= cap) return false;
    counts.set(domain, used + 1);
    return true;
  });
}

function queryTerms(queries: string[]): string[] {
  const terms = new Set<string>();
  for (const query of queries) {
    const text = String(query || '').toLowerCase();
    for (const word of text.match(/[a-z0-9][a-z0-9._-]{2,}/g) || []) terms.add(word);
    for (const run of text.match(/[㐀-鿿]+/g) || []) {
      if (run.length === 1) terms.add(run);
      for (let index = 0; index < run.length - 1; index += 1) {
        terms.add(run.slice(index, index + 2));
      }
    }
  }
  return [...terms];
}

function freshnessScore(date?: string | null): number {
  if (!date) return 0;
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return 0;
  const days = (Date.now() - time) / 86400000;
  if (days <= 180) return 3;
  if (days <= 365) return 2;
  if (days <= 730) return 1;
  return 0;
}

/** 相关度 + 来源类型 + 时效 + 正文/摘要素；分数只用于排序，不对外展示。 */
export function rankEvidence(refs: WebReference[], queries: string[]): WebReference[] {
  const terms = queryTerms(queries);
  return refs
    .map((ref) => {
      const text = `${ref.title} ${ref.snippet} ${ref.summary || ''}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += titleBoost(ref, term);
      }
      score += freshnessScore(ref.date);
      const type = ref.sourceType || sourceTypeOf(siteOf(ref.url));
      if (type === 'official' || type === 'paper' || type === 'repo') score += 2;
      else if (type === 'news') score += 1;
      if (ref.content) score += 2;
      if (ref.summary) score += 1;
      if (Number.isFinite(ref.authority)) score += Math.max(0, Math.min(4, ref.authority as number));
      if (Number.isFinite(ref.rerank)) score += Math.max(0, Math.min(3, ref.rerank as number));
      return { ref, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.ref);
}

function titleBoost(ref: WebReference, term: string): number {
  const title = String(ref.title || '').toLowerCase();
  return title.includes(term) ? 3 : 1;
}

function activePlatform(settings: AppSettings): SearchPlatform | undefined {
  return (
    settings.search.platforms.find((item) => item.id === settings.search.activeId) ||
    settings.search.platforms[0]
  );
}

function cacheKey(platform: SearchPlatform, query: string, max: number): string {
  return `${platform.id}|${platform.kind || ''}|${platform.baseUrl || ''}|${query}|${max}|${
    settingsKey(platform)
  }`;
}

function settingsKey(platform: SearchPlatform): string {
  // 缓存只按平台和查询区分；Key 变化时手动清空（重启也会清空），避免把不同 Key 的结果混用。
  return platform.apiKey ? String(platform.apiKey).slice(-4) : 'nokey';
}

async function searchOnce(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string,
  max: number
): Promise<{ refs: WebReference[]; cached: boolean }> {
  const ttl = Math.max(0, Number(settings.search.cacheMinutes) || 0) * 60000;
  const key = cacheKey(platform, query, max);
  if (ttl > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return { refs: hit.refs.map((ref) => ({ ...ref })), cached: true };
  }
  const rows = await runProviderSearch(settings, platform, query);
  const refs = await prepareResults(rows, { ...settings, search: { ...settings.search, fetchPages: false } }, max);
  if (ttl > 0) {
    cache.set(key, { at: Date.now(), refs });
    if (cache.size > CACHE_MAX) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - CACHE_MAX);
      for (const [oldKey] of oldest) cache.delete(oldKey);
    }
  }
  return { refs, cached: false };
}

async function withFallback(
  settings: AppSettings,
  platform: SearchPlatform,
  queries: string[],
  max: number
): Promise<{ refs: WebReference[]; fallback: boolean; cached: boolean }> {
  let refs: WebReference[] = [];
  let cached = false;
  for (const query of queries) {
    const result = await searchOnce(settings, platform, query, max);
    refs = refs.concat(result.refs);
    cached = cached || result.cached;
  }
  if (refs.length || settings.search.keylessFallback === false) return { refs, fallback: false, cached };

  for (const id of settings.search.keylessOrder || ['anysearch', 'searxng']) {
    if (id !== 'anysearch' && id !== 'searxng') continue;
    try {
      const free = freePlatform(id);
      const result = await searchOnce(settings, free, queries[0] || '', max);
      if (result.refs.length) return { refs: result.refs, fallback: true, cached: false };
    } catch {
      // 继续下一个免费源
    }
  }
  return { refs, fallback: false, cached };
}

export interface SearchWebOptions {
  signal?: AbortSignal;
  maxResults?: number;
  /** 合并后抓取正文的条数；0 表示不抓 */
  read?: number;
}

/** 执行检索计划：并发查询 → 合并 → 去重 → 域名限流 → 排序 → 抓正文 → 分配引用 id。 */
export async function searchWebPlan(
  settings: AppSettings,
  plan: SearchPlanItem[],
  options: SearchWebOptions = {}
): Promise<WebSearchResult> {
  const started = Date.now();
  const queries = plan.map((item) => item.query).filter(Boolean);
  const empty: WebSearchResult = {
    evidence: [],
    meta: {
      queries,
      engine: '',
      fallback: false,
      cached: false,
      raw: 0,
      deduped: 0,
      fetched: 0,
      elapsedMs: 0,
      failures: []
    }
  };
  if (!settings.search.enabled || !queries.length) return empty;
  const platform = activePlatform(settings);
  if (!platform) return empty;

  const max = Math.max(1, Math.min(20, options.maxResults || settings.search.maxResults || 6));
  const settled = await Promise.allSettled(
    plan.map((item) =>
      withSearchSignal(options.signal, () => searchOnce(settings, platform, item.query, max))
    )
  );
  const failures: string[] = [];
  let raw: WebReference[] = [];
  let cached = false;
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      raw = raw.concat(result.value.refs);
      cached = cached || result.value.cached;
    } else {
      failures.push(`${queries[index]}: ${(result.reason as Error)?.message || String(result.reason)}`);
    }
  });

  let fallback = false;
  if (!raw.length) {
    const rescued = await withFallback(settings, platform, queries, max);
    raw = rescued.refs;
    fallback = rescued.fallback;
  }

  const withSite = raw.map((ref) => {
    const site = siteOf(ref.url);
    return { ...ref, site, sourceType: ref.sourceType || sourceTypeOf(site) };
  });
  const deduped = dedupeEvidence(withSite);
  const ranked = capPerDomain(rankEvidence(deduped, queries), 2).slice(0, Math.max(max, 7));

  const readCount = Math.max(0, Math.min(4, options.read ?? 2));
  const evidence: WebEvidence[] = [];
  const fetched = await Promise.allSettled(
    ranked.slice(0, readCount).map(async (ref) => {
      const cached = cachedDocument(ref.url);
      if (cached) return { url: ref.url, text: cached, cached: true };
      const text = await withSearchSignal(options.signal, () =>
        fetchPageText(ref.url, Math.max(600, settings.search.snippetChars || 2000))
      );
      if (text) rememberDocument(ref.url, text);
      return { url: ref.url, text, cached: false };
    })
  );
  const pageText = new Map<string, string>();
  fetched.forEach((item) => {
    if (item.status === 'fulfilled' && item.value.text) pageText.set(item.value.url, item.value.text);
  });

  const prefix = `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
  ranked.forEach((ref, index) => {
    const content = pageText.get(ref.url);
    evidence.push({
      ...ref,
      site: ref.site || siteOf(ref.url),
      content: content || ref.content,
      snippet: content && content.length > 120 ? content.slice(0, 1200) : ref.snippet,
      citeId: `${prefix}-${index + 1}`
    });
  });

  const meta: WebSearchMeta = {
    queries,
    engine: platform.name || platform.kind || '检索',
    fallback,
    cached,
    raw: raw.length,
    deduped: deduped.length,
    fetched: pageText.size,
    elapsedMs: Date.now() - started,
    failures
  };
  recordSearch({
    queries,
    engine: meta.engine,
    fallback,
    cached,
    raw: meta.raw,
    deduped: meta.deduped,
    fetched: meta.fetched,
    elapsedMs: meta.elapsedMs,
    failures: failures.length
  });
  return { evidence, meta };
}
