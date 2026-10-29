// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseBookmarksHtml } from './bookmarks';

const HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>书签栏</H3>
  <DL><p>
    <DT><A HREF="https://www.bilibili.com/">哔哩哔哩</A>
    <DT><H3>学习</H3>
    <DL><p>
      <DT><A HREF="https://developer.mozilla.org/">MDN</A>
      <DT><A HREF="https://example.com/a">Example</A>
    </DL><p>
    <DT><A HREF="https://www.zhihu.com/">知乎</A>
    <DT><A HREF="javascript:alert(1)">坏链接</A>
    <DT><A HREF="https://www.zhihu.com/">知乎重复</A>
  </DL><p>
</DL><p>`;

describe('parseBookmarksHtml', () => {
  it('按文件夹分组、去重并跳过非 http 链接', () => {
    const result = parseBookmarksHtml(HTML);
    expect(result.shortcuts).toHaveLength(4);
    expect(result.shortcuts.map((item) => item.label)).toEqual([
      '哔哩哔哩',
      'MDN',
      'Example',
      '知乎'
    ]);
    expect(result.shortcuts[0].group).toBe('常用');
    expect(result.shortcuts[1].group).toBe('学习');
    expect(result.shortcuts[2].group).toBe('学习');
    expect(result.shortcuts[3].group).toBe('常用');
    expect(result.folders).toBe(2);
  });

  it('空内容返回空结果', () => {
    expect(parseBookmarksHtml('')).toEqual({ shortcuts: [], folders: 0 });
  });
});
