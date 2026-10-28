import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/shizi-test' },
  session: { defaultSession: { fetch: state.fetch } },
  safeStorage: { isEncryptionAvailable: () => false }
}));

import { fetchWebPage } from './fetch';

describe('web_fetch', () => {
  it('读取网页标题与正文', async () => {
    state.fetch.mockResolvedValue(
      new Response('<html><head><title>测试标题</title></head><body><p>第一段正文</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    );
    const page = await fetchWebPage('https://example.com/a');
    expect(page.title).toContain('测试标题');
    expect(page.text).toContain('第一段正文');
  });

  it('按 URL 获取服务商走 Jina Reader', async () => {
    state.fetch.mockResolvedValue(
      new Response('Title: Jina 页面\n\n正文内容', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      })
    );
    const page = await fetchWebPage('https://example.com/j', 3000, undefined, {
      id: 'jina',
      name: 'Jina',
      kind: 'jina',
      baseUrl: 'https://r.jina.ai',
      apiKey: ''
    });
    expect(page.title).toBe('Jina 页面');
    expect(page.text).toContain('正文内容');
    expect(page.via).toBe('jina');
    expect(String(state.fetch.mock.calls[0][0])).toContain('https://r.jina.ai/https://example.com/j');
  });

  it('第三方读取失败时回退内置抓取', async () => {
    state.fetch
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          '<html><head><title>回退标题</title></head><body><p>回退正文</p></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        )
      );
    const page = await fetchWebPage('https://example.com/f', 3000, undefined, {
      id: 'jina',
      name: 'Jina',
      kind: 'jina',
      baseUrl: 'https://r.jina.ai',
      apiKey: ''
    });
    expect(page.title).toContain('回退标题');
    expect(page.text).toContain('回退正文');
    expect(page.via).toBe('direct');
    expect(page.fallbackFrom).toBe('jina');
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(String(state.fetch.mock.calls[0][0])).toContain('r.jina.ai');
    expect(String(state.fetch.mock.calls[1][0])).toContain('example.com/f');
  });

  it('拒绝本机/内网地址', async () => {
    await expect(fetchWebPage('http://127.0.0.1/admin')).rejects.toThrow('本机');
    await expect(fetchWebPage('http://192.168.1.2/a')).rejects.toThrow('本机');
    await expect(fetchWebPage('file:///etc/passwd')).rejects.toThrow('http');
  });

  it('重定向到内网也会被拒绝', async () => {
    state.fetch.mockResolvedValue(
      new Response('', { status: 302, headers: { location: 'http://10.0.0.1/x' } })
    );
    await expect(fetchWebPage('https://example.com/redirect')).rejects.toThrow('本机');
  });
});
