import { describe, expect, it } from 'vitest';
import { compactUrl } from './url';

describe('compactUrl', () => {
  it('去掉协议、www 与末尾斜杠', () => {
    expect(compactUrl('https://www.bilibili.com/')).toBe('bilibili.com');
    expect(compactUrl('https://www.bilibili.com/video/BV1xx411c7mD/')).toBe(
      'bilibili.com/video/BV1xx411c7mD'
    );
    expect(compactUrl('http://example.com/a/b/')).toBe('example.com/a/b');
  });

  it('保留查询串，去掉 hash', () => {
    expect(compactUrl('https://search.bilibili.com/all?keyword=test#anchor')).toBe(
      'search.bilibili.com/all?keyword=test'
    );
  });

  it('非 http 协议与无效输入原样返回', () => {
    expect(compactUrl('file:///C:/a.mp4')).toBe('file:///C:/a.mp4');
    expect(compactUrl('about:blank')).toBe('about:blank');
    expect(compactUrl('')).toBe('');
  });

  it('不能解析时也做基本清理', () => {
    expect(compactUrl('https://bad host/')).toBe('bad host');
  });
});
