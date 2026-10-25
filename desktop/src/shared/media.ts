/**
 * 播放倍速的共享规则：主进程、渲染层和页内控制面板共用同一套数值定义。
 *
 * 这里只放纯函数，不碰 Electron / DOM，方便单测。
 */
import type { AppSettings } from './types';

/** Chromium 的 playbackRate 支持 0.0625–16；下限收到 0.25 更符合看课习惯。 */
export const MEDIA_MIN_RATE = 0.25;
export const MEDIA_MAX_RATE = 16;
/** 快捷键/微调步长 */
export const MEDIA_SMALL_STEP = 0.1;
/** 大步长 */
export const MEDIA_BIG_STEP = 1;
/** 滑块默认只覆盖常用区间，更大的倍速用预设或输入框。 */
export const MEDIA_SLIDER_MIN = 0.25;
export const MEDIA_SLIDER_MAX = 4;
export const MEDIA_SLIDER_STEP = 0.05;
/** 面板里的快捷预设，参考 Global Speed 的布局。 */
export const MEDIA_RATE_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 16];
/** 记住的站点数量上限，避免设置文件无限膨胀。 */
const MAX_SITE_RULES = 200;

/** 保留两位小数，并夹在允许区间内。 */
export function clampMediaRate(value: unknown, fallback = 1): number {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return fallback;
  const rounded = Math.round(rate * 100) / 100;
  return Math.min(MEDIA_MAX_RATE, Math.max(MEDIA_MIN_RATE, rounded));
}

/** 在当前倍速上加减，结果仍会夹取。 */
export function stepMediaRate(current: unknown, delta: number): number {
  const base = clampMediaRate(current);
  return clampMediaRate(base + (Number(delta) || 0));
}

/** 工具栏展示：1 / 1.25 / 1.5 / 16，不带多余小数。 */
export function formatMediaRate(rate: unknown): string {
  const value = clampMediaRate(rate);
  return `${Number(value.toFixed(2))}×`;
}

/** 面板输入框展示：固定两位小数，便于对齐。 */
export function formatMediaRateFixed(rate: unknown): string {
  return clampMediaRate(rate).toFixed(2);
}

/** 从 URL 取站点键：小写 hostname，去掉 www.。 */
export function mediaSiteKey(url: string): string {
  try {
    const parsed = new URL(String(url || ''));
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 清洗设置里读出的站点倍速表。 */
export function sanitizeMediaSiteRates(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {};
  const entries: Array<[string, number]> = [];
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey || '')
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    if (!key || /[\s/]/.test(key)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    entries.push([key, clampMediaRate(value)]);
  }
  return Object.fromEntries(entries.slice(-MAX_SITE_RULES));
}

/** 命中站点规则时返回倍速，否则返回 null。 */
export function rememberedMediaRate(general: AppSettings['general'], url: string): number | null {
  if (general.mediaRememberSite === false) return null;
  const key = mediaSiteKey(url);
  if (!key) return null;
  const value = general.mediaSiteRates?.[key];
  return typeof value === 'number' ? clampMediaRate(value) : null;
}

/** 页面加载/新建标签时决定初始倍速。 */
export function resolveMediaRate(general: AppSettings['general'], url: string): number {
  return rememberedMediaRate(general, url) ?? clampMediaRate(general.mediaRate);
}
