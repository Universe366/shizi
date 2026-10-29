import type { StartShortcut, StartWallpaperMedia } from '../../../../shared/types';

export type WallpaperId = 'aurora' | 'midnight' | 'paper' | 'mint' | 'peach' | 'bing';

export type { StartWallpaperMedia };

export interface WeatherDay {
  date: string;
  high: number;
  low: number;
  description: string;
}

export interface Weather {
  city: string;
  temperature: number;
  description: string;
  high: number;
  low: number;
  humidity?: number;
  wind?: number;
  apparent?: number;
  forecast?: WeatherDay[];
  hourly?: Array<{
    time: string;
    temperature: number;
    precipitation: number;
    description: string;
  }>;
  airQuality?: { aqi: number; level: string; pm25: number } | null;
}

export function formatHourLabel(time: string): string {
  const hour = Number(String(time).slice(11, 13));
  return Number.isFinite(hour) && String(time).length >= 13 ? `${hour}时` : time;
}

export const WIDGET_LABELS: Record<string, string> = {
  weather: '天气',
  todo: '待办',
  pomodoro: '番茄钟',
  notes: '便签',
  hot: '热搜',
  recent: '最近入库',
  history: '最近访问',
  quote: '每日一句'
};

export const ALL_WIDGETS = [
  'weather',
  'todo',
  'pomodoro',
  'notes',
  'hot',
  'recent',
  'history',
  'quote'
] as const;

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

export interface LunarDate {
  /** 干支年名，如「丙午」 */
  yearName: string;
  /** 农历月，如「九月」 */
  month: string;
  /** 农历日，如「二十」 */
  day: string;
  /** 展示文本：丙午年 九月二十 */
  text: string;
}

const LUNAR_DAYS = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十'
] as const;

/**
 * 农历日期：用 Intl 的中文历法取出干支年与月日。
 * 某些精简 ICU 构建不带 chinese 历法，此时返回 null，由调用方回退到公历。
 */
export function lunarDate(date: Date): LunarDate | null {
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const parts = formatter.formatToParts(date);
    const yearName = parts.find((part) => String(part.type) === 'yearName')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const dayNumber = Number(parts.find((part) => part.type === 'day')?.value || '');
    if (!month || !Number.isFinite(dayNumber) || dayNumber < 1 || dayNumber > 30) return null;
    const day = LUNAR_DAYS[dayNumber - 1];
    return {
      yearName,
      month,
      day,
      text: `${yearName ? `${yearName}年 ` : ''}${month}${day}`
    };
  } catch {
    return null;
  }
}

/** 壁纸平均亮度采样：0 全黑，1 全白；读不到（CORS / 无 canvas）返回 null。 */
function sampleLuminance(source: CanvasImageSource): number | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, 32, 32);
    const data = context.getImageData(0, 0, 32, 32).data;
    let total = 0;
    let weight = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      const luminance =
        (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
      total += luminance * alpha;
      weight += alpha;
    }
    return weight > 0 ? total / weight : null;
  } catch {
    return null;
  }
}

export function imageLuminance(src: string, crossOrigin = false): Promise<number | null> {
  return new Promise((resolve) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(sampleLuminance(image));
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** 取视频第一帧做亮度采样；远程视频没有 CORS 时返回 null。 */
export function videoLuminance(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onloadeddata = () => resolve(sampleLuminance(video));
    video.onerror = () => resolve(null);
    video.src = src;
  });
}

export type InkMode = 'light' | 'dark';

/** 亮壁纸配深色字，暗壁纸配浅色字；无法判断时保持主题默认。 */
export function inkForLuminance(luminance: number | null): InkMode | null {
  if (luminance === null || !Number.isFinite(luminance)) return null;
  return luminance < 0.55 ? 'light' : 'dark';
}

/** 远程壁纸直链：按扩展名推断类型，校验失败返回 null。 */
export function wallpaperMediaFromUrl(value: string): StartWallpaperMedia | null {
  const url = String(value || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return null;
  const kind = /\.(mp4|webm|ogv)(?:[?#]|$)/i.test(url)
    ? 'video'
    : /\.gif(?:[?#]|$)/i.test(url)
      ? 'gif'
      : 'image';
  return { kind, source: 'url', url };
}

export type PomodoroPhase = 'work' | 'short' | 'long';

export const POMODORO_SECONDS: Record<PomodoroPhase, number> = {
  work: 25 * 60,
  short: 5 * 60,
  long: 15 * 60
};

export const POMODORO_LABELS: Record<PomodoroPhase, string> = {
  work: '专注',
  short: '短休',
  long: '长休'
};

/** 每完成 4 个专注进入长休；休息结束回到专注。 */
export function nextPomodoroPhase(
  phase: PomodoroPhase,
  completedRounds: number
): PomodoroPhase {
  if (phase !== 'work') return 'work';
  return completedRounds > 0 && completedRounds % 4 === 0 ? 'long' : 'short';
}

export function formatPomodoro(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 预报日期标签：今天 / 明天 / 后天 / 周几。 */
export function forecastLabel(date: string, now = new Date()): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((parsed.getTime() - start.getTime()) / 86_400_000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()];
}

export interface ClockOptions {
  seconds: boolean;
  hour12: boolean;
}

export function formatClock(date: Date, options: ClockOptions): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' as const } : {}),
    hour12: options.hour12
  });
}

/** 必应图库的 startdate（YYYYMMDD）转成「9月20日」。 */
export function formatBingDate(value: string): string {
  if (!/^\d{8}$/.test(value)) return '';
  return `${Number(value.slice(4, 6))}月${Number(value.slice(6, 8))}日`;
}

export type TemperatureUnit = 'c' | 'f';

export function formatTemperature(celsius: number, unit: TemperatureUnit): string {
  const value = unit === 'f' ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(Number.isFinite(value) ? value : 0)}°`;
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
    wallpaperMedia?: StartWallpaperMedia;
    effect?: { blur: number; dim: number };
    minimal?: boolean;
    engine?: string;
    city?: string;
    widgets?: string[];
    weatherOn?: boolean;
    hotOn?: boolean;
    notes?: string;
    usage?: StartUsage;
    pomodoroRounds?: number;
    bingImage?: string;
    bingCopyright?: string;
    dockIds?: string[];
    clock?: ClockOptions;
    weatherUnit?: TemperatureUnit;
    bingFavorites?: string[];
    rotateMinutes?: number;
    groups?: string[];
  };
}

export interface StartBackupInput {
  shortcuts: StartShortcut[];
  wallpaper?: string;
  wallpaperImage?: string;
  wallpaperMedia?: StartWallpaperMedia;
  effect?: { blur: number; dim: number };
  minimal?: boolean;
  engine?: string;
  city?: string;
  widgets?: string[];
  weatherOn?: boolean;
  hotOn?: boolean;
  notes?: string;
  usage?: StartUsage;
  pomodoroRounds?: number;
  bingImage?: string;
  bingCopyright?: string;
  dockIds?: string[];
  clock?: ClockOptions;
  weatherUnit?: TemperatureUnit;
  bingFavorites?: string[];
  rotateMinutes?: number;
  groups?: string[];
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
      // 本地 GIF/视频在 IndexedDB 里，导出时无法带走，只备份直链。
      wallpaperMedia:
        input.wallpaperMedia && input.wallpaperMedia.source === 'url'
          ? input.wallpaperMedia
          : undefined,
      effect: input.effect,
      minimal: input.minimal,
      engine: input.engine,
      city: input.city,
      widgets: input.widgets,
      weatherOn: input.weatherOn,
      hotOn: input.hotOn,
      notes: input.notes !== undefined ? String(input.notes).slice(0, 20000) : undefined,
      usage: input.usage,
      pomodoroRounds: input.pomodoroRounds,
      bingImage: input.bingImage,
      bingCopyright: input.bingCopyright,
      dockIds: input.dockIds,
      clock: input.clock,
      weatherUnit: input.weatherUnit,
      bingFavorites: input.bingFavorites,
      rotateMinutes: input.rotateMinutes,
      groups: input.groups
    }
  };
}

export type ParsedBackup =
  | { ok: true; data: StartBackup }
  | { ok: false; error: string };

function parseBackupMedia(value: unknown): StartWallpaperMedia | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const kind = row.kind;
  const source = row.source;
  if (
    (kind !== 'image' && kind !== 'gif' && kind !== 'video') ||
    (source !== 'file' && source !== 'url')
  ) {
    return undefined;
  }
  const url = typeof row.url === 'string' ? row.url.trim().slice(0, 2000) : '';
  if (source === 'url' && !/^https?:\/\//i.test(url)) return undefined;
  return { kind, source, ...(source === 'url' ? { url } : {}) };
}

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
        wallpaperMedia: parseBackupMedia(prefsRaw.wallpaperMedia),
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
        hotOn: prefsRaw.hotOn === true,
        notes: typeof prefsRaw.notes === 'string' ? prefsRaw.notes.slice(0, 20000) : undefined,
        usage: normalizeUsage(prefsRaw.usage),
        pomodoroRounds: Number.isFinite(Number(prefsRaw.pomodoroRounds))
          ? Math.max(0, Math.min(9999, Math.floor(Number(prefsRaw.pomodoroRounds))))
          : undefined,
        bingImage:
          typeof prefsRaw.bingImage === 'string' &&
          (/^https?:\/\//i.test(prefsRaw.bingImage) ||
            /^data:image\//i.test(prefsRaw.bingImage))
            ? prefsRaw.bingImage.slice(0, 4000)
            : undefined,
        bingCopyright:
          typeof prefsRaw.bingCopyright === 'string'
            ? prefsRaw.bingCopyright.slice(0, 200)
            : undefined,
        dockIds: Array.isArray(prefsRaw.dockIds)
          ? prefsRaw.dockIds
              .filter((item): item is string => typeof item === 'string')
              .slice(0, 8)
          : undefined,
        clock:
          prefsRaw.clock && typeof prefsRaw.clock === 'object'
            ? {
                seconds: (prefsRaw.clock as Record<string, unknown>).seconds === true,
                hour12: (prefsRaw.clock as Record<string, unknown>).hour12 === true
              }
            : undefined,
        weatherUnit: prefsRaw.weatherUnit === 'f' ? 'f' : prefsRaw.weatherUnit === 'c' ? 'c' : undefined,
        bingFavorites: Array.isArray(prefsRaw.bingFavorites)
          ? prefsRaw.bingFavorites
              .filter(
                (item): item is string =>
                  typeof item === 'string' &&
                  (/^https?:\/\//i.test(item) || /^data:image\//i.test(item))
              )
              .slice(0, 30)
          : undefined,
        rotateMinutes: [0, 5, 15, 30, 60].includes(Number(prefsRaw.rotateMinutes))
          ? Number(prefsRaw.rotateMinutes)
          : undefined,
        groups: Array.isArray(prefsRaw.groups)
          ? Array.from(
              new Set(
                prefsRaw.groups
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter(Boolean)
              )
            ).slice(0, 30)
          : undefined
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

export interface SiteProbe {
  title: string;
  description: string;
}

/** 批量导入时，名称还是“域名”的条目才值得自动补全。 */
export function shouldAutofillLabel(label: string, url: string): boolean {
  const value = String(label || '').trim().toLowerCase();
  if (!value) return true;
  return value === hostOf(url).toLowerCase();
}

/**
 * 给批量导入的条目补标题/描述：只处理名称是域名的条目，最多 limit 个，
 * 3 路并发；任何一条失败都保留原值。
 */
export async function autofillShortcuts(
  items: StartShortcut[],
  probe: (url: string) => Promise<SiteProbe>,
  limit = 8
): Promise<{ items: StartShortcut[]; filled: number }> {
  const next = items.map((item) => ({ ...item }));
  const targets = next
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => shouldAutofillLabel(item.label, item.url))
    .slice(0, Math.max(0, limit));
  let filled = 0;

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const current = targets[cursor];
      cursor += 1;
      try {
        const meta = await probe(current.item.url);
        const title = String(meta?.title || '').trim().slice(0, 40);
        const description = String(meta?.description || '').trim().slice(0, 120);
        if (!title && !description) continue;
        next[current.index] = {
          ...next[current.index],
          ...(title ? { label: title } : {}),
          ...(description && !next[current.index].desc ? { desc: description } : {})
        };
        filled += 1;
      } catch {
        // 单个站点失败不影响其它条目
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()));
  return { items: next, filled };
}

export type StartUsage = Record<string, number>;

/** 使用次数只保留正整数，避免导入坏数据把 UI 撑坏。 */
export function normalizeUsage(value: unknown): StartUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage: StartUsage = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const number = Number(count);
    if (Number.isFinite(number) && number > 0) usage[key] = Math.min(9999, Math.floor(number));
  }
  return Object.keys(usage).length ? usage : undefined;
}

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
