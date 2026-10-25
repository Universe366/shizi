import { describe, expect, it } from 'vitest';
import type { AppSettings } from './types';
import {
  MEDIA_MAX_RATE,
  MEDIA_MIN_RATE,
  MEDIA_RATE_PRESETS,
  clampMediaRate,
  formatMediaRate,
  formatMediaRateFixed,
  mediaSiteKey,
  rememberedMediaRate,
  resolveMediaRate,
  sanitizeMediaSiteRates,
  stepMediaRate
} from './media';

type General = AppSettings['general'];

function general(patch: Record<string, unknown> = {}): General {
  return {
    mediaRate: 1,
    mediaRememberSite: true,
    mediaSiteRates: {},
    mediaPreservePitch: true,
    mediaSingleKey: false,
    mediaWidget: true,
    ...patch
  } as unknown as General;
}

describe('倍速数值', () => {
  it('夹在 0.25–16，并保留两位小数', () => {
    expect(clampMediaRate(0.1)).toBe(MEDIA_MIN_RATE);
    expect(clampMediaRate(20)).toBe(MEDIA_MAX_RATE);
    expect(clampMediaRate(1.234)).toBe(1.23);
    expect(clampMediaRate('1.5')).toBe(1.5);
    expect(clampMediaRate(Number.NaN)).toBe(1);
    expect(clampMediaRate(undefined, 2)).toBe(2);
  });

  it('步进不会越过上下限', () => {
    expect(stepMediaRate(1, 0.1)).toBe(1.1);
    expect(stepMediaRate(0.25, -0.1)).toBe(0.25);
    expect(stepMediaRate(15.95, 0.1)).toBe(16);
    expect(stepMediaRate(2, 1)).toBe(3);
  });

  it('工具栏和面板的格式化不一样', () => {
    expect(formatMediaRate(1)).toBe('1×');
    expect(formatMediaRate(1.5)).toBe('1.5×');
    expect(formatMediaRate(1.25)).toBe('1.25×');
    expect(formatMediaRateFixed(1.5)).toBe('1.50');
    expect(formatMediaRateFixed(16)).toBe('16.00');
  });

  it('预设覆盖常用档位且都在允许范围内', () => {
    expect(MEDIA_RATE_PRESETS).toContain(1);
    expect(MEDIA_RATE_PRESETS).toContain(1.5);
    expect(MEDIA_RATE_PRESETS).toContain(16);
    for (const rate of MEDIA_RATE_PRESETS) {
      expect(rate).toBeGreaterThanOrEqual(MEDIA_MIN_RATE);
      expect(rate).toBeLessThanOrEqual(MEDIA_MAX_RATE);
    }
  });
});

describe('站点记忆', () => {
  it('从 URL 取小写 hostname 并去掉 www.', () => {
    expect(mediaSiteKey('https://www.bilibili.com/video/BV1?t=3')).toBe('bilibili.com');
    expect(mediaSiteKey('https://M.BILIBILI.COM/x')).toBe('m.bilibili.com');
    expect(mediaSiteKey('about:blank')).toBe('');
    expect(mediaSiteKey('not a url')).toBe('');
  });

  it('清洗站点表：丢掉非法项、夹取倍速、去重前保留最近 200 个', () => {
    const cleaned = sanitizeMediaSiteRates({
      'WWW.Bilibili.com': 1.5,
      'example.com': 99,
      'bad key': 2,
      ignored: 'abc'
    });
    expect(cleaned).toEqual({ 'bilibili.com': 1.5, 'example.com': 16 });

    const many = Object.fromEntries(
      Array.from({ length: 220 }, (_, index) => [`site${index}.com`, 1.5])
    );
    expect(Object.keys(sanitizeMediaSiteRates(many))).toHaveLength(200);
  });

  it('命中站点规则时优先于默认倍速', () => {
    const value = general({ mediaRate: 1.25, mediaSiteRates: { 'bilibili.com': 2 } });
    expect(rememberedMediaRate(value, 'https://www.bilibili.com/video/BV1')).toBe(2);
    expect(resolveMediaRate(value, 'https://www.bilibili.com/video/BV1')).toBe(2);
    expect(resolveMediaRate(value, 'https://example.com/a')).toBe(1.25);
  });

  it('关闭站点记忆后忽略规则', () => {
    const value = general({ mediaRate: 1.5, mediaRememberSite: false, mediaSiteRates: { 'bilibili.com': 2 } });
    expect(rememberedMediaRate(value, 'https://www.bilibili.com/video/BV1')).toBeNull();
    expect(resolveMediaRate(value, 'https://www.bilibili.com/video/BV1')).toBe(1.5);
  });
});
