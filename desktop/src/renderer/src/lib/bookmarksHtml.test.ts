// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Bookmark, BookmarkFolder } from '../../../shared/types';
import { buildBookmarksHtml } from './bookmarksHtml';
import { parseBookmarksHtml } from '../components/start/bookmarks';

const bookmarks: Bookmark[] = [
  { id: 1, url: 'https://a.example/x?a=1&b=2', title: 'A & B', favicon: null, folder: '', createdAt: 2 },
  { id: 2, url: 'https://b.example', title: '学习资料', favicon: null, folder: '学习', createdAt: 1 }
];
const folders: BookmarkFolder[] = [{ name: '学习', createdAt: 1, count: 1 }];

describe('buildBookmarksHtml', () => {
  it('生成 Chrome 兼容结构，并转义标题', () => {
    const html = buildBookmarksHtml(bookmarks, folders);
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('HREF="https://a.example/x?a=1&amp;b=2"');
    expect(html).toContain('<H3>学习</H3>');
  });

  it('导出的 HTML 能被现有导入解析器读回', () => {
    const html = buildBookmarksHtml(bookmarks, folders);
    const parsed = parseBookmarksHtml(html);
    expect(parsed.shortcuts.map((item) => item.url)).toEqual([
      'https://a.example/x?a=1&b=2',
      'https://b.example'
    ]);
    expect(parsed.folders).toBeGreaterThan(0);
  });
});
