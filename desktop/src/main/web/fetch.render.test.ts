import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  loadURL: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ title: '渲染标题', text: '渲染正文'.repeat(80) })),
  destroy: vi.fn()
}));

vi.mock('electron', () => ({
  session: { defaultSession: { fetch: state.fetch } },
  BrowserWindow: class {
    webContents = { executeJavaScript: state.execute };
    loadURL = state.loadURL;
    isDestroyed() {
      return false;
    }
    destroy = state.destroy;
  }
}));

import { fetchWebPage } from './fetch';

describe('强 JS 页面浏览器渲染兜底', () => {
  it('原始正文过短时用隐藏浏览器渲染', async () => {
    state.fetch.mockResolvedValue(
      new Response(
        '<html><head><title>空壳</title></head><body><div id="root"></div><script>app()</script></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      )
    );
    const page = await fetchWebPage('https://example.com/spa', 3200);
    expect(page.rendered).toBe(true);
    expect(page.title).toBe('渲染标题');
    expect(page.text).toContain('渲染正文');
    expect(state.loadURL).toHaveBeenCalledWith('https://example.com/spa');
    expect(state.destroy).toHaveBeenCalled();
  });
});
