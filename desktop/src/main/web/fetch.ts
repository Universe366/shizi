import { session } from 'electron';
import { htmlToText } from '../search';

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

/** 打开一篇公开网页并抽取正文；带私有地址拦截、手动重定向校验与 8 秒超时。 */
export async function fetchWebPage(
  input: string,
  maxChars = 6000,
  signal?: AbortSignal
): Promise<WebPage> {
  let target = assertPublicUrl(String(input || '').trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  if (signal?.aborted) controller.abort();
  try {
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
