import { ipcMain } from 'electron';
import { probeSiteMeta } from '../startMeta';
import { loadSettings } from '../settings';
import { pullStartData, pushStartData, startSyncStatus } from '../startSync';
import { failure } from './shared';

/** 起始页小组件：天气（Open-Meteo，免 key）与 B 站热搜，都带内存缓存。 */

interface WeatherDay {
  date: string;
  high: number;
  low: number;
  description: string;
}

interface WeatherHour {
  time: string;
  temperature: number;
  precipitation: number;
  description: string;
}

interface AirQuality {
  aqi: number;
  level: string;
  pm25: number;
}

interface WeatherInfo {
  city: string;
  temperature: number;
  description: string;
  high: number;
  low: number;
  humidity: number;
  wind: number;
  apparent: number;
  forecast: WeatherDay[];
  hourly: WeatherHour[];
  airQuality: AirQuality | null;
}

function aqiLevel(aqi: number): string {
  if (aqi <= 50) return '优';
  if (aqi <= 100) return '良';
  if (aqi <= 150) return '轻度污染';
  if (aqi <= 200) return '中度污染';
  if (aqi <= 300) return '重度污染';
  return '严重污染';
}

const WEATHER_TTL = 30 * 60 * 1000;
const HOT_TTL = 10 * 60 * 1000;
let weatherCache: { city: string; at: number; data: WeatherInfo } | null = null;
let locateCache: { at: number; city: string } | null = null;
let hotCache: { at: number; data: string[] } | null = null;
const suggestCache = new Map<string, { at: number; data: string[] }>();
const SUGGEST_TTL = 10 * 60 * 1000;
let bingCache: { at: number; data: { url: string; copyright: string } } | null = null;
type GallerySource = 'bing' | 'picsum' | 'wallhaven';
interface GalleryItem {
  url: string;
  copyright: string;
  date: string;
}
const galleryCache = new Map<GallerySource, { at: number; data: GalleryItem[] }>();

const WEATHER_CODES: Record<number, string> = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '小雨',
  55: '中雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '强雷暴'
};

function describe(code: number): string {
  return WEATHER_CODES[code] || '未知';
}

async function requestJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 Shizi/0.38', ...headers },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function fetchWeather(city: string): Promise<WeatherInfo> {
  const geo = await requestJson<{
    results?: Array<{ latitude: number; longitude: number; name: string }>;
  }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`
  );
  const place = geo.results?.[0];
  if (!place) throw new Error('找不到这个城市');
  const forecast = await requestJson<{
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      relative_humidity_2m?: number;
      wind_speed_10m?: number;
      apparent_temperature?: number;
    };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      precipitation_probability?: number[];
      weather_code?: number[];
    };
  }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,apparent_temperature' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&hourly=temperature_2m,precipitation_probability,weather_code&forecast_hours=12' +
      '&timezone=auto&forecast_days=4'
  );
  let airQuality: AirQuality | null = null;
  try {
    const air = await requestJson<{
      current?: { us_aqi?: number; pm2_5?: number };
    }>(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.latitude}&longitude=${place.longitude}&current=us_aqi,pm2_5&timezone=auto`
    );
    const aqi = Math.round(Number(air.current?.us_aqi ?? 0));
    if (Number.isFinite(aqi) && aqi > 0) {
      airQuality = {
        aqi,
        level: aqiLevel(aqi),
        pm25: Math.round(Number(air.current?.pm2_5 ?? 0))
      };
    }
  } catch {
    // 空气质量是可选数据
  }
  const temperature = Number(forecast.current?.temperature_2m ?? 0);
  const code = Number(forecast.current?.weather_code ?? 0);
  const days = forecast.daily?.time || [];
  return {
    city: place.name || city,
    temperature,
    description: describe(code),
    high: Number(forecast.daily?.temperature_2m_max?.[0] ?? temperature),
    low: Number(forecast.daily?.temperature_2m_min?.[0] ?? temperature),
    humidity: Number(forecast.current?.relative_humidity_2m ?? 0),
    wind: Number(forecast.current?.wind_speed_10m ?? 0),
    apparent: Number(forecast.current?.apparent_temperature ?? temperature),
    forecast: days.slice(0, 4).map((date, index) => ({
      date,
      high: Number(forecast.daily?.temperature_2m_max?.[index] ?? temperature),
      low: Number(forecast.daily?.temperature_2m_min?.[index] ?? temperature),
      description: describe(Number(forecast.daily?.weather_code?.[index] ?? 0))
    })),
    hourly: (forecast.hourly?.time || []).slice(0, 12).map((time, index) => ({
      time,
      temperature: Number(forecast.hourly?.temperature_2m?.[index] ?? temperature),
      precipitation: Math.round(
        Number(forecast.hourly?.precipitation_probability?.[index] ?? 0)
      ),
      description: describe(Number(forecast.hourly?.weather_code?.[index] ?? 0))
    })),
    airQuality
  };
}

async function fetchGallery(source: GallerySource): Promise<GalleryItem[]> {
  if (source === 'bing') {
    const response = await fetch(
      'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN',
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          referer: 'https://www.bing.com/'
        },
        signal: AbortSignal.timeout(10000)
      }
    );
    const json = (await response.json()) as {
      images?: Array<{ urlbase?: string; copyright?: string; startdate?: string }>;
    };
    const data = (json.images || [])
      .filter((image) => Boolean(image.urlbase))
      .map((image) => ({
        url: `https://www.bing.com${image.urlbase}_1920x1080.jpg`,
        copyright: String(image.copyright || ''),
        date: String(image.startdate || '')
      }));
    if (!data.length) throw new Error('必应图库为空');
    return data;
  }
  if (source === 'picsum') {
    const response = await fetch('https://picsum.photos/v2/list?page=1&limit=8', {
      headers: { 'User-Agent': 'Mozilla/5.0 Shizi/0.132' },
      signal: AbortSignal.timeout(10000)
    });
    const list = (await response.json()) as Array<{ id?: string; author?: string }>;
    const data = (list || [])
      .filter((item) => Boolean(item.id))
      .slice(0, 8)
      .map((item) => ({
        url: `https://picsum.photos/id/${item.id}/1920/1080`,
        copyright: `Photo by ${item.author || 'Picsum'} / Lorem Picsum`,
        date: ''
      }));
    if (!data.length) throw new Error('Picsum 图库为空');
    return data;
  }
  const response = await fetch(
    'https://wallhaven.cc/api/v1/search?sorting=toplist&purity=100&categories=111&ratios=16x9&page=1',
    {
      headers: { 'User-Agent': 'Mozilla/5.0 Shizi/0.132' },
      signal: AbortSignal.timeout(10000)
    }
  );
  const json = (await response.json()) as {
    data?: Array<{ path?: string; resolution?: string }>;
  };
  const data = (json.data || [])
    .filter((item) => Boolean(item.path))
    .slice(0, 8)
    .map((item) => ({
      url: String(item.path),
      copyright: `Wallhaven${item.resolution ? ` · ${item.resolution}` : ''}`,
      date: ''
    }));
  if (!data.length) throw new Error('Wallhaven 图库为空');
  return data;
}

async function fetchHot(): Promise<string[]> {
  const data = await requestJson<{
    data?: { trending?: { list?: Array<{ keyword?: string }> } };
  }>('https://api.bilibili.com/x/web-interface/search/square?limit=12', {
    Referer: 'https://www.bilibili.com/'
  });
  const list = data.data?.trending?.list || [];
  return list
    .map((item) => String(item.keyword || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function registerStartIpc(): void {
  ipcMain.handle('start:weather', async (_event, rawCity: unknown, force?: unknown) => {
    const city = String(rawCity || '上海').trim().slice(0, 20) || '上海';
    const now = Date.now();
    if (
      force !== true &&
      weatherCache &&
      weatherCache.city === city &&
      now - weatherCache.at < WEATHER_TTL
    ) {
      return { ok: true, data: weatherCache.data };
    }
    try {
      const data = await fetchWeather(city);
      weatherCache = { city, at: now, data };
      return { ok: true, data };
    } catch (error) {
      return failure(`天气获取失败：${(error as Error).message}`);
    }
  });

  ipcMain.handle('start:locate', async () => {
    const now = Date.now();
    if (locateCache && now - locateCache.at < 30 * 60 * 1000) {
      return { ok: true, data: { city: locateCache.city } };
    }
    try {
      const response = await fetch('https://whois.pconline.com.cn/ipJson.jsp?json=true', {
        headers: {
          'User-Agent': 'Mozilla/5.0 Shizi/0.132',
          Referer: 'https://whois.pconline.com.cn/'
        },
        signal: AbortSignal.timeout(8000)
      });
      const buffer = await response.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buffer);
      const data = JSON.parse(text) as { city?: string; pro?: string };
      const city = String(data.city || data.pro || '')
        .trim()
        .replace(/(市|地区|盟)$/, '');
      if (!city) throw new Error('未能识别城市');
      locateCache = { at: now, city };
      return { ok: true, data: { city } };
    } catch (error) {
      return failure(`定位失败：${(error as Error).message}`);
    }
  });

  ipcMain.handle('start:suggest', async (_event, rawQuery: unknown) => {
    const query = String(rawQuery || '').trim().slice(0, 40);
    if (query.length < 2) return { ok: true, data: [] };
    const cached = suggestCache.get(query);
    if (cached && Date.now() - cached.at < SUGGEST_TTL) {
      return { ok: true, data: cached.data };
    }
    try {
      const response = await fetch(
        `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}&mkt=zh-CN`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 Shizi/0.124' },
          signal: AbortSignal.timeout(3000)
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as [string, string[]];
      const list = Array.isArray(json?.[1]) ? json[1] : [];
      const data = list
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 6);
      if (suggestCache.size > 50) suggestCache.clear();
      suggestCache.set(query, { at: Date.now(), data });
      return { ok: true, data };
    } catch {
      // 联想失败静默回退本地建议
      return { ok: true, data: [] };
    }
  });

  ipcMain.handle('start:sync', async (_event, action: unknown, payload: unknown) => {
    const folder = String(loadSettings().general.syncFolder || '').trim();
    if (!folder) return failure('请先在 设置 → 数据与备份 里选择同步文件夹');
    try {
      if (action === 'push') return { ok: true, data: pushStartData(folder, payload) };
      if (action === 'pull') return { ok: true, data: pullStartData(folder) };
      return { ok: true, data: startSyncStatus(folder) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('start:bing-wallpaper', async () => {
    const now = Date.now();
    if (bingCache && now - bingCache.at < 60 * 60 * 1000) {
      return { ok: true, data: bingCache.data };
    }
    try {
      const response = await fetch(
        'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN',
        {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            referer: 'https://www.bing.com/'
          },
          signal: AbortSignal.timeout(10000)
        }
      );
      const json = (await response.json()) as {
        images?: Array<{ urlbase?: string; copyright?: string }>;
      };
      const image = json.images?.[0];
      if (!image?.urlbase) return failure('必应壁纸不可用');
      const data = {
        url: `https://www.bing.com${image.urlbase}_1920x1080.jpg`,
        copyright: String(image.copyright || '')
      };
      bingCache = { at: now, data };
      return { ok: true, data };
    } catch (error) {
      return failure(`必应壁纸获取失败：${(error as Error).message}`);
    }
  });

  const galleryHandler = async (source: GallerySource) => {
    const now = Date.now();
    const cached = galleryCache.get(source);
    if (cached && now - cached.at < 60 * 60 * 1000) {
      return { ok: true, data: cached.data };
    }
    try {
      const data = await fetchGallery(source);
      galleryCache.set(source, { at: now, data });
      return { ok: true, data };
    } catch (error) {
      return failure(`图库获取失败：${(error as Error).message}`);
    }
  };

  ipcMain.handle('start:bing-gallery', () => galleryHandler('bing'));

  ipcMain.handle('start:gallery', (_event, rawSource: unknown) =>
    galleryHandler(
      rawSource === 'picsum' || rawSource === 'wallhaven' ? rawSource : 'bing'
    )
  );

  ipcMain.handle('start:probe-site', async (_event, rawUrl: unknown) => {
    try {
      const meta = await probeSiteMeta(String(rawUrl || ''));
      return { ok: true, data: meta };
    } catch (error) {
      return failure(`站点信息获取失败：${(error as Error).message}`);
    }
  });

  ipcMain.handle('start:hot', async (_event, force?: boolean) => {
    const now = Date.now();
    if (!force && hotCache && now - hotCache.at < HOT_TTL) {
      return { ok: true, data: hotCache.data };
    }
    try {
      const data = await fetchHot();
      hotCache = { at: now, data };
      return { ok: true, data };
    } catch (error) {
      return failure(`热搜获取失败：${(error as Error).message}`);
    }
  });
}
