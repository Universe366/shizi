import type { SiteMeta } from '../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TTL_MS = 30 * 60 * 1000;
const MAX_HTML = 600_000;
const cache = new Map<string, { at: number; data: SiteMeta }>();

const PRIVATE_HOST =
  /^(localhost|127\..*|0\.0\.0\.0|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[::1\]|.*\.local)$/i;

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    '#39': "'"
  };
  return String(text || '')
    .replace(/&([a-z#0-9]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

function plain(text: string, max = 200): string {
  return decodeEntities(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function attr(html: string, tagPattern: RegExp, attrName: string): string {
  const match = tagPattern.exec(html);
  if (!match) return '';
  const tag = match[0];
  const attrMatch = new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return attrMatch ? attrMatch[1] : '';
}

/** 从网页 HTML 里提取标题、描述与图标；失败不抛错，返回空字段。 */
export function parseSiteMeta(html: string, pageUrl: string): SiteMeta {
  const url = new URL(pageUrl);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '';
  const ogTitle = attr(html, /<meta[^>]+property=["']og:title["'][^>]*>/i, 'content');
  const descTag = attr(html, /<meta[^>]+name=["']description["'][^>]*>/i, 'content');
  const ogDesc = attr(html, /<meta[^>]+property=["']og:description["'][^>]*>/i, 'content');
  const iconHref =
    attr(html, /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i, 'href') ||
    attr(html, /<link[^>]+href=["'][^"']*["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i, 'href');

  let icon = '';
  if (iconHref) {
    try {
      icon = new URL(iconHref, url).toString();
    } catch {
      icon = '';
    }
  }
  if (!icon) icon = `${url.protocol}//${url.host}/favicon.ico`;

  return {
    url: url.toString(),
    title: plain(ogTitle || titleTag, 120) || url.hostname.replace(/^www\./i, ''),
    description: plain(ogDesc || descTag, 200),
    icon
  };
}

/** 拉取站点元信息（标题/描述/图标），带 30 分钟内存缓存与私网拦截。 */
export async function probeSiteMeta(rawUrl: string): Promise<SiteMeta> {
  const url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error('只支持 http/https 地址');
  if (PRIVATE_HOST.test(url.hostname)) throw new Error('不能访问本机或内网地址');

  const cached = cache.get(url.origin);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { ...cached.data, url: url.toString() };
  }

  const response = await fetch(url.toString(), {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error('不是网页内容');
  const html = (await response.text()).slice(0, MAX_HTML);
  const meta = parseSiteMeta(html, response.url || url.toString());
  cache.set(url.origin, { at: Date.now(), data: meta });
  return meta;
}
