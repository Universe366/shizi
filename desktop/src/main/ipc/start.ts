import { ipcMain } from 'electron';
import { failure } from './shared';

/** 起始页小组件：天气（Open-Meteo，免 key）与 B 站热搜，都带内存缓存。 */

interface WeatherInfo {
  city: string;
  temperature: number;
  description: string;
  high: number;
  low: number;
}

const WEATHER_TTL = 30 * 60 * 1000;
const HOT_TTL = 10 * 60 * 1000;
let weatherCache: { city: string; at: number; data: WeatherInfo } | null = null;
let hotCache: { at: number; data: string[] } | null = null;

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
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min' +
      '&timezone=auto&forecast_days=1'
  );
  const temperature = Number(forecast.current?.temperature_2m ?? 0);
  const code = Number(forecast.current?.weather_code ?? 0);
  return {
    city: place.name || city,
    temperature,
    description: describe(code),
    high: Number(forecast.daily?.temperature_2m_max?.[0] ?? temperature),
    low: Number(forecast.daily?.temperature_2m_min?.[0] ?? temperature)
  };
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
  ipcMain.handle('start:weather', async (_event, rawCity: unknown) => {
    const city = String(rawCity || '上海').trim().slice(0, 20) || '上海';
    const now = Date.now();
    if (weatherCache && weatherCache.city === city && now - weatherCache.at < WEATHER_TTL) {
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
