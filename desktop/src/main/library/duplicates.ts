import type { LibraryDuplicateGroup, LibraryVideo } from '../../shared/types';
import { listLibrary } from './videos';

function urlKey(video: LibraryVideo): string {
  if (video.bvid) return `bvid:${video.bvid.toLowerCase()}`;
  try {
    const parsed = new URL(video.url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `url:${host}${path}`;
  } catch {
    return '';
  }
}

function titleKey(video: LibraryVideo): string {
  return String(video.title || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?:：;；'"“”‘’（）()【】]/g, '')
    .slice(0, 80);
}

/** 按 BVID / 规范化 URL 优先，其次按规范化标题找重复。 */
export function findDuplicateVideos(limit = 100): LibraryDuplicateGroup[] {
  const videos = listLibrary('updated').videos;
  const groups: LibraryDuplicateGroup[] = [];
  const used = new Set<number>();
  const push = (reason: 'url' | 'title', key: string, items: LibraryVideo[]) => {
    if (items.length < 2) return;
    items.forEach((item) => used.add(item.id));
    groups.push({
      key: `${reason}:${key}`,
      reason,
      videos: items.sort((a, b) => a.createdAt - b.createdAt).slice(0, 20)
    });
  };

  const byUrl = new Map<string, LibraryVideo[]>();
  for (const video of videos) {
    const key = urlKey(video);
    if (!key) continue;
    const bucket = byUrl.get(key);
    if (bucket) bucket.push(video);
    else byUrl.set(key, [video]);
  }
  for (const [key, items] of byUrl) push('url', key, items);
  if (groups.length >= limit) return groups.slice(0, limit);

  const byTitle = new Map<string, LibraryVideo[]>();
  for (const video of videos) {
    if (used.has(video.id)) continue;
    const key = titleKey(video);
    if (!key) continue;
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(video);
    else byTitle.set(key, [video]);
  }
  for (const [key, items] of byTitle) {
    push('title', key, items);
    if (groups.length >= limit) break;
  }
  return groups.slice(0, limit);
}
