import type { StartShortcut } from '../../../../shared/types';

export type WallpaperId = 'aurora' | 'midnight' | 'paper' | 'mint' | 'peach' | 'bing';

export interface Weather {
  city: string;
  temperature: number;
  description: string;
  high: number;
  low: number;
}

export const WIDGET_LABELS: Record<string, string> = {
  weather: '天气',
  todo: '待办',
  hot: '热搜',
  recent: '最近入库',
  history: '最近访问'
};

export const ALL_WIDGETS = ['weather', 'todo', 'hot', 'recent', 'history'] as const;

export const WALLPAPERS: Array<{ id: WallpaperId; label: string }> = [
  { id: 'aurora', label: '极光' },
  { id: 'midnight', label: '夜空' },
  { id: 'paper', label: '纸白' },
  { id: 'mint', label: '薄荷' },
  { id: 'peach', label: '蜜桃' },
  { id: 'bing', label: '必应每日' }
];

export const QUICK_LINKS = [
  { label: 'B 站热门', url: 'https://www.bilibili.com/v/popular/all' },
  { label: '稍后再看', url: 'https://www.bilibili.com/watchlater/list' },
  { label: '番剧', url: 'https://www.bilibili.com/anime/' },
  { label: '直播', url: 'https://live.bilibili.com/' }
];

export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 统一成 https://host 形式，用于比较与取 favicon。 */
export function originOf(url: string): string {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

export function hostOf(url: string): string {
  return originOf(url).replace(/^https?:\/\//, '');
}

/** 站点自己的 favicon：只请求用户收藏的那个域名，不经过第三方图标服务。 */
export function faviconOf(url: string): string {
  const origin = originOf(url);
  return origin ? `${origin}/favicon.ico` : '';
}

/** 从域名生成稳定的色板，作为没有 favicon 时的字母底色。 */
export function tileColor(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const hue = hash;
  return {
    bg: `hsl(${hue} 46% 42%)`,
    fg: '#ffffff'
  };
}

export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function matchShortcut(item: StartShortcut, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return false;
  return (
    item.label.toLowerCase().includes(keyword) ||
    hostOf(item.url).toLowerCase().includes(keyword) ||
    item.url.toLowerCase().includes(keyword)
  );
}

export function isUrlLike(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return /^(https?:\/\/|www\.)/i.test(text) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(text);
}
