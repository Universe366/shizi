import type { SidebarPage } from './types';

/** 侧栏网页的默认站点：地址都指向各家的对话首页。 */
export const SIDEBAR_PAGE_PRESETS: SidebarPage[] = [
  { id: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'doubao', title: '豆包', url: 'https://www.doubao.com/chat/' },
  { id: 'kimi', title: 'Kimi', url: 'https://www.kimi.com/' },
  { id: 'qwen', title: '通义', url: 'https://chat.qwen.ai/' },
  { id: 'chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com/' }
];

/** 侧栏网页数量上限，避免一次塞进几十个进程。 */
export const SIDEBAR_PAGE_LIMIT = 20;

function titleFromUrl(url: URL): string {
  return url.hostname.replace(/^www\./i, '').slice(0, 40);
}

/**
 * 规范化侧栏网页列表：只保留 http/https，标题/网址做长度限制，id 去重。
 * 非法条目直接丢弃，不抛错（设置文件可能被手改）。
 */
export function normalizeSidebarPages(input: unknown): SidebarPage[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const pages: SidebarPage[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || pages.length >= SIDEBAR_PAGE_LIMIT) continue;
    const raw = item as { id?: unknown; title?: unknown; url?: unknown };
    const rawUrl = String(raw.url || '').trim();
    if (!/^https?:\/\//i.test(rawUrl)) continue;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    const id = String(raw.id || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = String(raw.title || '').trim().slice(0, 40) || titleFromUrl(url);
    pages.push({ id, title, url: url.toString().slice(0, 2000) });
  }
  return pages;
}

/** 新加网页时生成一个不会和现有条目冲突的 id。 */
export function nextSidebarPageId(pages: SidebarPage[]): string {
  const used = new Set(pages.map((page) => page.id));
  let index = pages.length + 1;
  while (used.has(`page-${index}`)) index += 1;
  return `page-${index}`;
}
