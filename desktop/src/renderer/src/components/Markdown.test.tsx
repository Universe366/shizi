// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Markdown } from './Markdown';

const source = {
  title: '来源文章',
  url: 'https://example.com/post',
  snippet: '摘要',
  site: 'example.com',
  date: '2026-01-02'
};

describe('Markdown 引用', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('有来源时 [n] 渲染成可点击 chip', () => {
    const open = vi.fn(() => Promise.resolve({ ok: true, data: true }));
    Object.defineProperty(window, 'bsub', { configurable: true, value: { openExternal: open } });
    render(<Markdown content="这是一条结论[1]。" citations={[source]} />);
    const chip = document.querySelector('.cite-ref') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe('1');
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith(source.url);
  });

  it('有同名锚点时点击只滚动不打开链接', () => {
    const open = vi.fn(() => Promise.resolve({ ok: true, data: true }));
    Object.defineProperty(window, 'bsub', { configurable: true, value: { openExternal: open } });
    const anchor = document.createElement('div');
    anchor.id = 'cite-m1-1';
    document.body.appendChild(anchor);
    anchor.scrollIntoView = vi.fn();
    render(<Markdown content="结论[1]" citations={[source]} citePrefix="m1" />);
    fireEvent.click(document.querySelector('.cite-ref') as HTMLElement);
    expect(anchor.scrollIntoView).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    anchor.remove();
  });

  it('中文句子里的金额不会被当成公式', () => {
    const { container } = render(<Markdown content={'价格 $5 到 $10 之间，公式 $x^2$ 正常'} />);
    expect(document.querySelectorAll('.katex').length).toBe(1);
    expect(container.textContent).toContain('$5 到 $10');
  });

  it('加粗与行内代码不跨行', () => {
    render(<Markdown content={'**第一段\n第二段**\n\u0060a\nb\u0060'} />);
    expect(document.querySelector('strong')).toBeNull();
    expect(document.querySelector('code')).toBeNull();
  });

  it('<br> 会换行而不是原样显示', () => {
    render(<Markdown content={'第一行<br>第二行'} />);
    expect(document.body.textContent).not.toContain('<br>');
    expect(screen.getByText('第一行')).toBeTruthy();
    expect(screen.getByText('第二行')).toBeTruthy();
  });

  it('支持 5 级标题与 *** 分割线', () => {
    render(<Markdown content={'##### 小标题\n\n***'} />);
    expect(document.querySelector('h5')?.textContent).toBe('小标题');
    expect(document.querySelector('hr')).toBeTruthy();
  });

  it('表格渲染成表格', () => {
    render(<Markdown content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />);
    expect(document.querySelectorAll('table th').length).toBe(2);
    expect(document.querySelectorAll('table td').length).toBe(2);
  });

  it('没有来源时保留原文 [1]', () => {
    render(<Markdown content="普通文本 [1]" />);
    expect(document.querySelector('.cite-ref')).toBeNull();
    expect(screen.getByText(/普通文本/).textContent).toContain('[1]');
  });
});
