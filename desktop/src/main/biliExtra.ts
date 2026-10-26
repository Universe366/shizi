import { createHash } from 'node:crypto';
import type { VideoPoint } from '../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
  19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60,
  51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

/** B 站 WBI 混入 key：img_key + sub_key 按固定表取 32 位。 */
export function mixinKey(imgKey: string, subKey: string): string {
  const raw = `${imgKey}${subKey}`;
  return MIXIN_TAB.map((index) => raw[index] || '')
    .join('')
    .slice(0, 32);
}

export function wbiQuery(params: Record<string, string | number>, mixin: string): string {
  const signed: Record<string, string | number> = {
    ...params,
    wts: Math.floor(Date.now() / 1000)
  };
  const query = Object.keys(signed)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(
          String(signed[key]).replace(/[!'()*]/g, '')
        )}`
    )
    .join('&');
  const wRid = createHash('md5').update(query + mixin).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

interface CacheEntry {
  at: number;
  points: VideoPoint[];
}
const cache = new Map<string, CacheEntry>();
const TTL = 5 * 60 * 1000;

async function wbiKeys(): Promise<string | null> {
  try {
    const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'user-agent': UA, referer: REFERER },
      signal: AbortSignal.timeout(5000)
    });
    const json = (await response.json()) as {
      data?: { wbi_img?: { img_url?: string; sub_url?: string } };
    };
    const image = json.data?.wbi_img?.img_url;
    const sub = json.data?.wbi_img?.sub_url;
    if (!image || !sub) return null;
    const pick = (url: string) => String(url).split('/').pop()?.split('.')[0] || '';
    return mixinKey(pick(image), pick(sub));
  } catch {
    return null;
  }
}

/**
 * 读取 B 站官方分段（view_points）。失败返回空数组，绝不阻塞总结。
 * 只有 from < to 且标题非空的条目才算分段，看点/空壳会被过滤。
 */
export async function fetchViewPoints(bvid: string, cid: number): Promise<VideoPoint[]> {
  if (!bvid || !cid) return [];
  const key = `${bvid}:${cid}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL) return cached.points;
  const mixin = await wbiKeys();
  if (!mixin) {
    cache.set(key, { at: Date.now(), points: [] });
    return [];
  }
  try {
    const query = wbiQuery({ bvid, cid }, mixin);
    const response = await fetch(`https://api.bilibili.com/x/player/wbi/v2?${query}`, {
      headers: { 'user-agent': UA, referer: REFERER },
      signal: AbortSignal.timeout(6000)
    });
    const json = (await response.json()) as {
      code?: number;
      data?: { view_points?: Array<Record<string, unknown>> };
    };
    if (json.code !== 0) return [];
    const points: VideoPoint[] = [];
    for (const row of json.data?.view_points || []) {
      const title = String(row.content || row.title || '').trim();
      const start = Number(row.from ?? row.start ?? 0);
      const end = Number(row.to ?? row.end ?? 0);
      if (!title || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (end <= start) continue;
      points.push({
        title: title.slice(0, 120),
        start: Math.max(0, Math.round(start)),
        end: Math.max(0, Math.round(end))
      });
    }
    points.sort((a, b) => a.start - b.start);
    cache.set(key, { at: Date.now(), points });
    if (cache.size > 100) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    return points;
  } catch {
    cache.set(key, { at: Date.now(), points: [] });
    return [];
  }
}
