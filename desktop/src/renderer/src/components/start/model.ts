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
    item.url.toLowerCase().includes(keyword) ||
    String(item.desc || '').toLowerCase().includes(keyword) ||
    (item.tags || []).some((tag) => tag.toLowerCase().includes(keyword))
  );
}

export interface ParsedShortcut {
  label: string;
  url: string;
  group: string;
}

/**
 * 批量粘贴解析：每行支持
 *   名称 URL / 名称,URL / 名称 | URL / 纯网址
 * 空行与 # 开头的行会忽略，重复网址只保留第一条。
 */
export function parseShortcutLines(text: string, defaultGroup = '常用'): ParsedShortcut[] {
  const result: ParsedShortcut[] = [];
  const seen = new Set<string>();

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const urlFirst = line.match(/^((?:https?:\/\/)?[^\s,|]+\.[^\s,|]+)(?:[\s,|]+(.+))?$/i);
    let label = '';
    let url = '';

    if (urlFirst && !/\s/.test(urlFirst[1])) {
      url = normalizeUrl(urlFirst[1]);
      label = (urlFirst[2] || '').trim();
    } else {
      const parts = line.split(/[\s,|]+/).filter(Boolean);
      if (parts.length < 2) continue;
      url = normalizeUrl(parts[parts.length - 1]);
      label = parts.slice(0, -1).join(' ');
    }

    if (!/^https?:\/\/[^\s]+$/i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const host = hostOf(url).replace(/^www\./i, '');
    result.push({
      label: (label || host || url).slice(0, 20),
      url,
      group: defaultGroup
    });
  }

  return result;
}

export function isUrlLike(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return /^(https?:\/\/|www\.)/i.test(text) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(text);
}

export type StartDensity = 'comfortable' | 'compact' | 'large';

export const DENSITIES: Array<{ id: StartDensity; label: string; hint: string }> = [
  { id: 'comfortable', label: '舒适', hint: '标准卡片，显示域名' },
  { id: 'compact', label: '紧凑', hint: '小卡片，只显示图标和名称' },
  { id: 'large', label: '大图标', hint: '更大的图标，适合少数常用站点' }
];

export function isStartDensity(value: unknown): value is StartDensity {
  return value === 'comfortable' || value === 'compact' || value === 'large';
}

export interface StartBackup {
  app: 'shizi-start';
  version: 1;
  exportedAt: string;
  shortcuts: StartShortcut[];
  prefs: {
    wallpaper?: string;
    wallpaperImage?: string;
    effect?: { blur: number; dim: number };
    minimal?: boolean;
    engine?: string;
    city?: string;
    widgets?: string[];
    weatherOn?: boolean;
    hotOn?: boolean;
  };
}

export interface StartBackupInput {
  shortcuts: StartShortcut[];
  wallpaper?: string;
  wallpaperImage?: string;
  effect?: { blur: number; dim: number };
  minimal?: boolean;
  engine?: string;
  city?: string;
  widgets?: string[];
  weatherOn?: boolean;
  hotOn?: boolean;
}

const MAX_BACKUP_SHORTCUTS = 500;

function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeShortcutUrl(value: unknown): string {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/** 导出当前起始页：快捷方式 + 外观偏好，便于换机或分享。 */
export function buildStartBackup(input: StartBackupInput): StartBackup {
  return {
    app: 'shizi-start',
    version: 1,
    exportedAt: new Date().toISOString(),
    shortcuts: input.shortcuts
      .map((item) => ({
        id: item.id,
        label: cleanText(item.label, 40),
        url: normalizeShortcutUrl(item.url),
        group: cleanText(item.group || '常用', 24),
        ...(cleanText(item.desc, 120) ? { desc: cleanText(item.desc, 120) } : {}),
        ...(item.tags?.length ? { tags: normalizeTags(item.tags).slice(0, 6) } : {})
      }))
      .filter((item) => item.label && item.url)
      .slice(0, MAX_BACKUP_SHORTCUTS),
    prefs: {
      wallpaper: input.wallpaper,
      wallpaperImage: input.wallpaperImage,
      effect: input.effect,
      minimal: input.minimal,
      engine: input.engine,
      city: input.city,
      widgets: input.widgets,
      weatherOn: input.weatherOn,
      hotOn: input.hotOn
    }
  };
}

export type ParsedBackup =
  | { ok: true; data: StartBackup }
  | { ok: false; error: string };

/** 解析导入文件：只接受本应用的格式，网址无效的条目会被跳过。 */
export function parseStartBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(String(text || ''));
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '文件内容不是对象' };
  const source = raw as Record<string, unknown>;
  if (source.app !== 'shizi-start') return { ok: false, error: '不是拾字起始页的备份文件' };
  const list = Array.isArray(source.shortcuts) ? source.shortcuts : [];
  const shortcuts: StartShortcut[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = cleanText(row.label, 40);
    const url = normalizeShortcutUrl(row.url);
    if (!label || !url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    shortcuts.push({
      id: typeof row.id === 'string' && row.id ? row.id : `s-${shortcuts.length + 1}`,
      label,
      url,
      group: cleanText(row.group || '常用', 24) || '常用',
      ...(cleanText(row.desc, 120) ? { desc: cleanText(row.desc, 120) } : {}),
      ...(Array.isArray(row.tags) ? { tags: normalizeTags(row.tags as unknown[]) } : {})
    });
    if (shortcuts.length >= MAX_BACKUP_SHORTCUTS) break;
  }
  if (!shortcuts.length) return { ok: false, error: '备份里没有可用的快捷方式' };
  const prefsRaw = (source.prefs || {}) as Record<string, unknown>;
  const effect = prefsRaw.effect as { blur?: unknown; dim?: unknown } | undefined;
  return {
    ok: true,
    data: {
      app: 'shizi-start',
      version: 1,
      exportedAt: String(source.exportedAt || ''),
      shortcuts,
      prefs: {
        wallpaper: typeof prefsRaw.wallpaper === 'string' ? prefsRaw.wallpaper : undefined,
        wallpaperImage:
          typeof prefsRaw.wallpaperImage === 'string' ? prefsRaw.wallpaperImage : undefined,
        effect:
          effect && Number.isFinite(Number(effect.blur)) && Number.isFinite(Number(effect.dim))
            ? { blur: Number(effect.blur), dim: Number(effect.dim) }
            : undefined,
        minimal: prefsRaw.minimal === true,
        engine: typeof prefsRaw.engine === 'string' ? prefsRaw.engine : undefined,
        city: typeof prefsRaw.city === 'string' ? prefsRaw.city : undefined,
        widgets: Array.isArray(prefsRaw.widgets)
          ? prefsRaw.widgets.filter((item): item is string => typeof item === 'string').slice(0, 12)
          : undefined,
        weatherOn: prefsRaw.weatherOn === true,
        hotOn: prefsRaw.hotOn === true
      }
    }
  };
}

/** 合并导入：按 URL 去重，保留现有的 id 与顺序，新条目追加到末尾。 */
function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function mergeShortcuts(
  current: StartShortcut[],
  incoming: StartShortcut[]
): StartShortcut[] {
  const seen = new Set(current.map((item) => urlKey(item.url)));
  const merged = [...current];
  const stamp = Date.now().toString(36);
  for (const item of incoming) {
    const key = urlKey(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...item, id: `s-${stamp}-${merged.length}` });
    if (merged.length >= MAX_BACKUP_SHORTCUTS) break;
  }
  return merged;
}

/** 标签输入归一化：支持逗号/顿号/空格分隔，去重并限制个数与长度。 */
export function normalizeTags(input: string | unknown[]): string[] {
  const raw = Array.isArray(input) ? input.map(String) : String(input || '').split(/[,，、;；\s]+/);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const tag = String(value || '').replace(/^#/, '').trim().slice(0, 12);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 6) break;
  }
  return tags;
}

/** 所有出现过的标签及使用次数，按次数倒序。 */
export function topTags(
  shortcuts: StartShortcut[],
  limit = 12
): Array<{ tag: string; count: number }> {
  const map = new Map<string, { tag: string; count: number }>();
  for (const item of shortcuts) {
    for (const tag of item.tags || []) {
      const key = tag.toLowerCase();
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { tag, count: 1 });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'))
    .slice(0, Math.max(1, limit));
}

export function filterByTag(items: StartShortcut[], tag: string): StartShortcut[] {
  if (!tag) return items;
  const key = tag.toLowerCase();
  return items.filter((item) => (item.tags || []).some((value) => value.toLowerCase() === key));
}

export type StartUsage = Record<string, number>;

export function bumpUsage(usage: StartUsage, id: string): StartUsage {
  if (!id) return usage;
  return { ...usage, [id]: Math.min(9999, (usage[id] || 0) + 1) };
}

/** 常用站点：按打开次数倒序，最多 limit 个。 */
export function topUsed(
  shortcuts: StartShortcut[],
  usage: StartUsage,
  limit = 8
): StartShortcut[] {
  return shortcuts
    .filter((item) => (usage[item.id] || 0) > 0)
    .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0))
    .slice(0, Math.max(1, limit));
}
