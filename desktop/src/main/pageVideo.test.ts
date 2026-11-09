import { describe, expect, it } from 'vitest';
import { isBilibiliUrl, webVideoInfo } from './pageVideo';

describe('generic page video', () => {
  it('识别 B 站域名，其他站点走通用分支', () => {
    expect(isBilibiliUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isBilibiliUrl('https://www.douyin.com/video/123')).toBe(false);
    expect(isBilibiliUrl('not-a-url')).toBe(false);
  });

  it('标题去掉站点后缀，身份用页面 URL', () => {
    const info = webVideoInfo('https://www.douyin.com/video/123', {
      title: '一个视频 - 抖音',
      ogTitle: '',
      duration: 42,
      width: 720,
      height: 1280,
      author: '作者'
    });
    expect(info.kind).toBe('web');
    expect(info.title).toBe('一个视频');
    expect(info.duration).toBe(42);
    expect(info.signature).toBe('web:https://www.douyin.com/video/123');
    expect(info.url).toBe('https://www.douyin.com/video/123');
  });

  it('没有标题时回退到「网页视频」', () => {
    expect(webVideoInfo('https://example.com/a', null).title).toBe('网页视频');
  });
});
