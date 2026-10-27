import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedDocument, clearDocumentCache, documentCacheSize, rememberDocument } from './documents';

describe('document cache', () => {
  afterEach(() => {
    clearDocumentCache();
    vi.restoreAllMocks();
  });

  it('写入后可读取，清空返回条数', () => {
    rememberDocument('https://a.com/1', '正文');
    expect(cachedDocument('https://a.com/1')).toBe('正文');
    expect(documentCacheSize()).toBe(1);
    expect(clearDocumentCache()).toBe(1);
    expect(cachedDocument('https://a.com/1')).toBeUndefined();
  });

  it('超过 6 小时过期', () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(now);
    rememberDocument('https://a.com/2', '正文');
    spy.mockReturnValue(now + 6 * 60 * 60 * 1000 + 1);
    expect(cachedDocument('https://a.com/2')).toBeUndefined();
  });
});
