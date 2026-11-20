import type { StartShortcut } from '../../../../shared/types';
import { hostOf, normalizeUrl } from './model';

export interface BookmarkImport {
  shortcuts: StartShortcut[];
  folders: number;
}

const ROOT_NAMES = /^(书签栏|bookmarks bar|其他书签|other bookmarks|收藏夹)$/i;

/**
 * 解析 Chrome / Edge 导出的 bookmarks.html：
 * 顶层文件夹作为分组，嵌套文件夹保留为 folder，按网址去重，只收 http(s)。
 */
export function parseBookmarksHtml(html: string): BookmarkImport {
  if (typeof DOMParser === 'undefined') return { shortcuts: [], folders: 0 };
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const shortcuts: StartShortcut[] = [];
  const seen = new Set<string>();
  const folders = new Set<string>();

  for (const link of doc.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) continue;
    const url = normalizeUrl(href);
    const key = url.toLowerCase();
    if (seen.has(key)) continue;

    const names: string[] = [];
    let list = link.closest('dl');
    while (list) {
      const heading = list.parentElement?.querySelector('h3');
      const name = heading?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (name && !ROOT_NAMES.test(name)) names.unshift(name);
      const parent = list.parentElement;
      list = parent ? parent.closest('dl') : null;
    }
    const clean = names.slice(0, 3);
    const group = clean[0]?.slice(0, 24) || '常用';
    const folder =
      clean.length > 1 ? clean.slice(1).join(' / ').slice(0, 40) : undefined;

    seen.add(key);
    const label = (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    shortcuts.push({
      id: `bm-${shortcuts.length}`,
      label: label || hostOf(url) || url,
      url,
      group,
      ...(folder ? { folder } : {})
    });
    folders.add(`${group}\u0000${folder || ''}`);
    if (shortcuts.length >= 500) break;
  }

  return { shortcuts, folders: folders.size };
}
