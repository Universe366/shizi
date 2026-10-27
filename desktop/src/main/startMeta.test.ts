import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSiteMeta, probeSiteMeta } from './startMeta';

const HTML = `<!doctype html><html><head>
<title>拾字 · 字幕工具</title>
<meta name="description" content="把视频字幕变成笔记 &amp; 知识库">
<meta property="og:title" content="拾字 Shizi">
<link rel="icon" href="/static/icon.png">
</head><body>hi</body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseSiteMeta', () => {
  it('优先 og:title，解析描述与相对图标', () => {
    const meta = parseSiteMeta(HTML, 'https://example.com/a/b');
    expect(meta.title).toBe('拾字 Shizi');
    expect(meta.description).toBe('把视频字幕变成笔记 & 知识库');
    expect(meta.icon).toBe('https://example.com/static/icon.png');
  });

  it('没有图标时回退 favicon.ico，标题回退域名', () => {
    const meta = parseSiteMeta('<html><head></head></html>', 'https://www.example.org/');
    expect(meta.title).toBe('example.org');
    expect(meta.icon).toBe('https://www.example.org/favicon.ico');
  });
});

describe('probeSiteMeta', () => {
  it('抓取网页并返回元信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } }))
    );
    const meta = await probeSiteMeta('https://probe-a.example.com/');
    expect(meta.title).toBe('拾字 Shizi');
    expect(meta.description).toContain('笔记');
  });

  it('拒绝内网地址', async () => {
    await expect(probeSiteMeta('http://127.0.0.1:8080')).rejects.toThrow('本机或内网');
    await expect(probeSiteMeta('http://192.168.1.2/')).rejects.toThrow('本机或内网');
  });

  it('重定向到内网地址会被拦截', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeSiteMeta('https://probe-c.example.com/')).rejects.toThrow('本机或内网');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('非网页内容报错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('binary', { status: 200, headers: { 'content-type': 'image/png' } }))
    );
    await expect(probeSiteMeta('https://probe-b.example.com/')).rejects.toThrow('不是网页');
  });
});
