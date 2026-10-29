import type { StartShortcut } from '../../../../shared/types';
import { hostOf, normalizeUrl } from './model';

export interface BookmarkImport {
  shortcuts: StartShortcut[];
  folders: number;
}

const ROOT_NAMES = /^(书签栏|bookmarks bar|其他书签|other bookmarks|收藏夹)$/i;

/**
 * 解析 Chrome / Edge 导出的 bookmarks.html：
 * 保留文件夹作为分组，按网址去重，只收 http(s)。
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

    let group = '常用';
    const list = link.closest('dl');
    const heading = list?.parentElement?.querySelector('h3');
    const name = heading?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (name && !ROOT_NAMES.test(name)) group = name.slice(0, 24);
    if (name && ROOT_NAMES.test(name)) group = '常用';

    seen.add(key);
    const label = (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    shortcuts.push({
      id: `bm-${shortcuts.length}`,
      label: label || hostOf(url) || url,
      url,
      group
    });
    folders.add(group);
    if (shortcuts.length >= 500) break;
  }

  return { shortcuts, folders: folders.size };
}
