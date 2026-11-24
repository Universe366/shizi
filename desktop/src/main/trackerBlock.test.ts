import { describe, expect, it } from 'vitest';
import { isTrackerHost } from './trackerBlock';

describe('isTrackerHost', () => {
  it('拦截常见统计域名及其子域', () => {
    expect(isTrackerHost('www.google-analytics.com')).toBe(true);
    expect(isTrackerHost('hm.baidu.com')).toBe(true);
    expect(isTrackerHost('doubleclick.net')).toBe(true);
  });

  it('不误伤站点自身域名', () => {
    expect(isTrackerHost('www.bilibili.com')).toBe(false);
    expect(isTrackerHost('api.bilibili.com')).toBe(false);
    expect(isTrackerHost('google-analytics.com.evil.test')).toBe(false);
  });
});
