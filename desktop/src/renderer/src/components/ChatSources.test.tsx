// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatSources } from './ChatSources';

const sources = [
  {
    title: '巴黎是法国首都',
    url: 'https://example.com/paris',
    snippet: '巴黎位于法国北部，是法国首都。',
    site: 'example.com',
    date: '2026-01-02'
  },
  {
    title: '法国概况',
    url: 'https://news.example.org/france',
    snippet: '法国是西欧国家。',
    site: 'news.example.org'
  }
];

describe('ChatSources', () => {
  afterEach(cleanup);

  it('渲染编号、站点与摘要，点击打开外部链接', () => {
    const open = vi.fn(() => Promise.resolve({ ok: true, data: true }));
    Object.defineProperty(window, 'bsub', { configurable: true, value: { openExternal: open } });
    const { container } = render(
      <ChatSources sources={sources} engine="DeepSeek 服务端联网" messageIndex={2} />
    );

    expect(screen.getByText('参考资料')).toBeTruthy();
    expect(container.querySelector('.chat-sources-count')?.textContent).toBe('2');
    expect(screen.getByText('DeepSeek 服务端联网')).toBeTruthy();
    expect(container.querySelectorAll('.chat-source')).toHaveLength(2);
    expect(container.querySelector('#cite-m2-1')).toBeTruthy();
    expect(screen.getByText('巴黎是法国首都')).toBeTruthy();
    expect(screen.getByText(/example\.com · 2026-01-02/)).toBeTruthy();

    fireEvent.click(container.querySelector('#cite-m2-1') as HTMLElement);
    expect(open).toHaveBeenCalledWith('https://example.com/paris');
  });

  it('可以折叠与展开来源列表', () => {
    const { container } = render(<ChatSources sources={sources} messageIndex={0} />);
    const toggle = container.querySelector('.chat-sources-head') as HTMLElement;
    expect(container.querySelectorAll('.chat-source')).toHaveLength(2);
    fireEvent.click(toggle);
    expect(container.querySelectorAll('.chat-source')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(container.querySelectorAll('.chat-source')).toHaveLength(2);
  });
});
