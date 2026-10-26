import { describe, expect, it } from 'vitest';
import { buildSearchUrl, isSearchEngineId, SEARCH_ENGINES } from './searchEngines';

describe('搜索引擎模板', () => {
  it('常见引擎按模板拼 URL', () => {
    expect(buildSearchUrl('baidu', '字幕 工具')).toBe(
      'https://www.baidu.com/s?wd=%E5%AD%97%E5%B9%95%20%E5%B7%A5%E5%85%B7'
    );
    expect(buildSearchUrl('duckduckgo', 'test')).toBe('https://duckduckgo.com/?q=test');
    expect(buildSearchUrl('bilibili', 'AI')).toBe(
      'https://search.bilibili.com/all?keyword=AI'
    );
  });

  it('自定义模板使用 {q}，无效时回退必应', () => {
    expect(buildSearchUrl('custom', 'a b', 'https://s.example/?q={q}')).toBe(
      'https://s.example/?q=a%20b'
    );
    expect(buildSearchUrl('custom', 'x', 'https://s.example/?q=')).toBe(
      'https://www.bing.com/search?q=x'
    );
  });

  it('引擎 id 校验与清单完整性', () => {
    expect(isSearchEngineId('sogou')).toBe(true);
    expect(isSearchEngineId('nope')).toBe(false);
    const ids = SEARCH_ENGINES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('custom');
  });
});
