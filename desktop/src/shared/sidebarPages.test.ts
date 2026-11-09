import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_PAGE_LIMIT,
  SIDEBAR_PAGE_PRESETS,
  nextSidebarPageId,
  normalizeSidebarPages
} from './sidebarPages';

describe('sidebar pages', () => {
  it('默认预置包含 5 个对话站点', () => {
    expect(SIDEBAR_PAGE_PRESETS.map((page) => page.id)).toEqual([
      'deepseek',
      'doubao',
      'kimi',
      'qwen',
      'chatgpt'
    ]);
    for (const page of SIDEBAR_PAGE_PRESETS) {
      expect(page.url.startsWith('https://')).toBe(true);
    }
  });

  it('丢掉非法协议、非法网址和重复 id', () => {
    const pages = normalizeSidebarPages([
      { id: 'a', title: 'A', url: 'https://example.com/a' },
      { id: 'a', title: 'dup', url: 'https://example.com/b' },
      { id: 'b', title: 'B', url: 'file:///etc/passwd' },
      { id: 'c', title: 'C', url: 'not-a-url' },
      { id: 'd', title: '', url: 'https://www.example.com/x' }
    ]);
    expect(pages).toEqual([
      { id: 'a', title: 'A', url: 'https://example.com/a' },
      { id: 'd', title: 'example.com', url: 'https://www.example.com/x' }
    ]);
  });

  it('限制总体数量，并生成不冲突的 id', () => {
    const many = Array.from({ length: SIDEBAR_PAGE_LIMIT + 5 }, (_, index) => ({
      id: `p${index}`,
      title: `P${index}`,
      url: `https://example.com/${index}`
    }));
    expect(normalizeSidebarPages(many)).toHaveLength(SIDEBAR_PAGE_LIMIT);
    expect(nextSidebarPageId([{ id: 'page-2', title: '', url: 'https://a.com' }])).toBe('page-3');
  });
});
