import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/shizi-search-test' },
  session: { defaultSession: { fetch: vi.fn() } }
}));

import { htmlToText, isBlockedUrl } from './search';

describe('搜索结果黑名单', () => {
  it('支持 * 通配的域名规则', () => {
    expect(isBlockedUrl('https://a.example.com/post/1', ['*://*.example.com/*'])).toBe(true);
    expect(isBlockedUrl('https://example.org/post/1', ['*://*.example.com/*'])).toBe(false);
  });

  it('支持 /正则/', () => {
    expect(isBlockedUrl('https://site.test/spam123', ['/spam\\d+/'])).toBe(true);
    expect(isBlockedUrl('https://site.test/ok', ['/spam\\d+/'])).toBe(false);
  });

  it('非法正则不影响其它规则', () => {
    expect(isBlockedUrl('https://a.example.com/x', ['/([/', '*://*.example.com/*'])).toBe(true);
  });

  it('空规则不拦截', () => {
    expect(isBlockedUrl('https://a.com', [])).toBe(false);
    expect(isBlockedUrl('https://a.com', ['  '])).toBe(false);
  });
});

describe('网页正文提取', () => {
  it('去掉脚本/样式并解码实体', () => {
    const text = htmlToText(
      '<html><head><style>.a{color:red}</style></head><body><script>alert(1)</script>' +
        '<h1>A &amp; B</h1><p>第一段&nbsp;文本</p><p>第二段 &#65;</p></body></html>'
    );
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toContain('A & B');
    expect(text).toContain('第一段 文本');
    expect(text).toContain('第二段 A');
  });
});
