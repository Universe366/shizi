import fs from 'node:fs';
import path from 'node:path';
import { app, session } from 'electron';
import type { AppSettings, SearchPlatform, WebReference } from '../shared/types';
import { UA, searchSignal } from './web/providers/shared';
import { freePlatform, runProviderSearch } from './web/providers';

export { withSearchSignal } from './web/providers/shared';
export { freePlatform, runProviderSearch };


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
const SEARCH_CACHE_MAX_AGE = 7 * 86400000;
let cacheLoaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function searchCacheFile(): string {
  try {
    return app?.getPath ? path.join(app.getPath('userData'), 'search-cache.json') : '';
  } catch {
    return '';
  }
}

function loadSearchCache(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  const file = searchCacheFile();
  if (!file || !fs.existsSync(file)) return;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      entries?: Array<[string, { at: number; refs: WebReference[]; meta: SearchMeta }]>;
    };
    const cutoff = Date.now() - SEARCH_CACHE_MAX_AGE;
    for (const [key, entry] of data.entries || []) {
      if (!key || !entry || !Array.isArray(entry.refs)) continue;
      if (!Number.isFinite(entry.at) || entry.at < cutoff) continue;
      searchCache.set(key, entry);
    }
  } catch {
    // 缓存损坏不影响检索
  }
}

function persistSearchCache(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const file = searchCacheFile();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ version: 1, savedAt: Date.now(), entries: [...searchCache.entries()] })
      );
    } catch {
      // 磁盘不可写时忽略
    }
  }, 300);
  persistTimer.unref?.();
}

function rememberSearch(key: string, refs: WebReference[], meta: SearchMeta): void {
  searchCache.set(key, { at: Date.now(), refs, meta });
  if (searchCache.size > SEARCH_CACHE_MAX) {
    // 长期运行的桌面端不能无限攒检索结果：按时间淘汰最旧的一批。
    const oldest = [...searchCache.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, searchCache.size - SEARCH_CACHE_MAX);
    for (const [oldKey] of oldest) searchCache.delete(oldKey);
  }
  persistSearchCache();
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
  const noCompress = settings.search.snippetMode === 'none';
  const maxChars = noCompress
    ? 20000
    : Math.max(200, settings.search.snippetChars || 2000);
  let normalized = normalize(rows, max).filter(
    (ref) => !isBlockedUrl(ref.url, settings.search.blacklist || [])
  );
  normalized = normalized.map((ref) => ({
    ...ref,
    snippet: noCompress
      ? String(ref.snippet || '')
      : String(ref.snippet || '').slice(0, maxChars)
  }));
  if (settings.search.fetchPages && normalized.length) {
    normalized = await enrichWithPages(normalized, maxChars, 3);
  }
  return normalized;
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
  const cacheKey = `${platform.id}|${platform.kind || ''}|${platform.baseUrl || ''}|${query}|${max}|${settings.search.timeRange}|${settings.search.includeContent ? 1 : 0}|${settings.search.fetchPages ? 1 : 0}|${settings.search.snippetMode || 'truncate'}|${settings.search.snippetChars || 2000}|${(settings.search.blacklist || []).join(',')}`;
  const ttl = Math.max(0, settings.search.cacheMinutes || 0) * 60000;
  if (ttl > 0) {
    loadSearchCache();
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
          if (id === 'exa') {
            rows = await runProviderSearch(
              settings,
              {
                id: 'keyless-exa',
                name: 'Exa（免费兜底）',
                kind: 'exa',
                baseUrl: 'https://mcp.exa.ai/mcp',
                apiKey: ''
              },
              query
            );
          } else if (id === 'anysearch') {
            rows = await runProviderSearch(settings, freePlatform('anysearch'), query);
          } else if (id === 'searxng') {
            rows = await runProviderSearch(settings, freePlatform('searxng'), query);
          }
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