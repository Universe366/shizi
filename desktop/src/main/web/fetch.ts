import { session } from 'electron';
import { htmlToText } from '../search';
import type { SearchPlatform } from '../../shared/types';

const PRIVATE_HOST =
  /^(localhost|127\..*|0\.0\.0\.0|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[::1\]|.*\.local)$/i;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 Shizi/1.0';

export interface WebPage {
  url: string;
  title: string;
  text: string;
}

function assertPublicUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('链接格式不对');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('只支持 http/https 链接');
  }
  if (PRIVATE_HOST.test(parsed.hostname)) {
    throw new Error('不读取本机/内网地址');
  }
  if (!parsed.hostname.includes('.')) {
    throw new Error('域名不合法');
  }
  return parsed;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('服务返回的不是 JSON');
  }
}

function providerBase(provider: SearchPlatform | undefined, fallback: string): string {
  return String(provider?.baseUrl || '').trim() || fallback;
}

async function fetchViaProvider(
  target: URL,
  provider: SearchPlatform,
  maxChars: number,
  signal: AbortSignal
): Promise<WebPage> {
  const kind = provider.kind;
  const key = String(provider.apiKey || '').trim();
  if (kind === 'jina') {
    const base = providerBase(provider, 'https://r.jina.ai');
    const response = await session.defaultSession.fetch(
      base.replace(/\/$/, '') + '/' + target.href,
      {
        method: 'GET',
        headers: {
          'user-agent': UA,
          accept: 'text/plain,text/markdown',
          ...(key ? { authorization: 'Bearer ' + key } : {})
        },
        signal
      }
    );
    if (!response.ok) throw new Error('Jina 读取失败（HTTP ' + response.status + '）');
    const raw = (await response.text()).slice(0, Math.max(1000, maxChars));
    const title = /(?:^|\n)Title:\s*(.+)/.exec(raw)?.[1]?.trim() || '';
    return { url: target.href, title, text: raw.slice(0, maxChars) };
  }

  if (kind === 'tavily') {
    const base = providerBase(provider, 'https://api.tavily.com');
    const response = await session.defaultSession.fetch(base.replace(/\/$/, '') + '/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, urls: [target.href], extract_depth: 'basic' }),
      signal
    });
    if (!response.ok) throw new Error('Tavily 读取失败（HTTP ' + response.status + '）');
    const json = await jsonOf(response);
    const results = Array.isArray(json.results) ? json.results : [];
    const first = (results[0] || {}) as Record<string, unknown>;
    const text = textOf(first.raw_content) || textOf(first.content);
    if (!text.trim()) throw new Error('Tavily 没有返回正文');
    return { url: target.href, title: textOf(first.title), text: text.slice(0, maxChars) };
  }

  if (kind === 'exa') {
    const base = providerBase(provider, 'https://api.exa.ai');
    const response = await session.defaultSession.fetch(base.replace(/\/$/, '') + '/contents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ urls: [target.href], text: { maxCharacters: maxChars } }),
      signal
    });
    if (!response.ok) throw new Error('Exa 读取失败（HTTP ' + response.status + '）');
    const json = await jsonOf(response);
    const results = Array.isArray(json.results) ? json.results : [];
    const first = (results[0] || {}) as Record<string, unknown>;
    const text = textOf(first.text);
    if (!text.trim()) throw new Error('Exa 没有返回正文');
    return { url: target.href, title: textOf(first.title), text: text.slice(0, maxChars) };
  }

  if (kind === 'firecrawl') {
    const base = providerBase(provider, 'https://api.firecrawl.dev');
    const response = await session.defaultSession.fetch(base.replace(/\/$/, '') + '/v1/scrape', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: 'Bearer ' + key } : {})
      },
      body: JSON.stringify({ url: target.href, formats: ['markdown'] }),
      signal
    });
    if (!response.ok) throw new Error('Firecrawl 读取失败（HTTP ' + response.status + '）');
    const json = await jsonOf(response);
    const data = (json.data || {}) as Record<string, unknown>;
    const text = textOf(data.markdown) || textOf(data.content);
    if (!text.trim()) throw new Error('Firecrawl 没有返回正文');
    const metadata = (data.metadata || {}) as Record<string, unknown>;
    return { url: target.href, title: textOf(metadata.title), text: text.slice(0, maxChars) };
  }

  // custom：baseUrl 支持 {url} 占位，未提供时直接把目标 URL 拼在后面。
  const base = providerBase(provider, '');
  if (!base) throw new Error('自定义 URL 获取服务没有填写接口地址');
  const endpoint = base.includes('{url}')
    ? base.replace('{url}', encodeURIComponent(target.href))
    : base.replace(/\/$/, '') + '/' + target.href;
  const response = await session.defaultSession.fetch(endpoint, {
    method: 'GET',
    headers: {
      'user-agent': UA,
      accept: 'text/html,text/plain,application/json',
      ...(key ? { authorization: 'Bearer ' + key } : {})
    },
    signal
  });
  if (!response.ok) throw new Error('自定义读取失败（HTTP ' + response.status + '）');
  const type = response.headers.get('content-type') || '';
  const raw = (await response.text()).slice(0, 600000);
  if (type.includes('application/json')) {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const text = textOf(json.text) || textOf(json.content) || textOf(json.markdown);
    if (!text.trim()) throw new Error('自定义服务没有返回正文');
    return { url: target.href, title: textOf(json.title), text: text.slice(0, maxChars) };
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  return {
    url: target.href,
    title: titleMatch ? htmlToText(titleMatch[1]).slice(0, 200).trim() : '',
    text: htmlToText(raw).slice(0, maxChars)
  };
}

/** 打开一篇公开网页并抽取正文；支持内置抓取与 Jina/Tavily/Exa/Firecrawl。 */
export async function fetchWebPage(
  input: string,
  maxChars = 6000,
  signal?: AbortSignal,
  provider?: SearchPlatform
): Promise<WebPage> {
  let target = assertPublicUrl(String(input || '').trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const kind = String(provider?.kind || 'direct');
    if (kind !== 'direct' && provider) {
      try {
        return await fetchViaProvider(target, provider, maxChars, controller.signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        // 第三方读取失败（限流/Key/网络）时回退内置抓取，避免一次失败整轮问答中断。
      }
    }
    for (let hop = 0; hop < 4; hop += 1) {
      const response = await session.defaultSession.fetch(target.href, {
        method: 'GET',
        headers: { 'user-agent': UA, accept: 'text/html,text/plain' },
        redirect: 'manual',
        signal: controller.signal
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('重定向没有目标地址');
        target = assertPublicUrl(new URL(location, target).href);
        continue;
      }
      if (!response.ok) throw new Error('网页读取失败（HTTP ' + response.status + '）');
      const type = response.headers.get('content-type') || '';
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
        throw new Error('不是网页正文（' + (type || '未知类型') + '）');
      }
      const html = (await response.text()).slice(0, 600000);
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      const title = titleMatch ? htmlToText(titleMatch[1]).slice(0, 200).trim() : '';
      const text = htmlToText(html).slice(0, Math.max(1000, Math.min(12000, maxChars)));
      return { url: target.href, title, text };
    }
    throw new Error('重定向次数过多');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}
