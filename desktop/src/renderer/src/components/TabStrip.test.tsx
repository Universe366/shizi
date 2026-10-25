// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TabInfo } from '../../../shared/types';
import { TabStrip } from './TabStrip';

const tabs: TabInfo[] = [
  {
    id: 't1',
    title: 'B 站首页',
    url: 'https://www.bilibili.com/',
    loading: false,
    active: true,
    canGoBack: false,
    canGoForward: false,
    suspended: false,
    zoom: 1
  },
  {
    id: 't2',
    title: '',
    url: 'https://example.com',
    loading: false,
    active: false,
    canGoBack: false,
    canGoForward: false,
    suspended: true,
    zoom: 1
  },
  {
    id: 't3',
    title: '第三个',
    url: 'https://example.org',
    loading: false,
    active: false,
    canGoBack: false,
    canGoForward: false,
    suspended: false,
    zoom: 1
  }
];

function installBsub() {
  const api = {
    activateTab: vi.fn(async () => ({ ok: true })),
    closeTab: vi.fn(async () => undefined),
    moveTab: vi.fn(async () => undefined),
    newTab: vi.fn(),
    writeClipboard: vi.fn(async () => ({ ok: true })),
    pinTab: vi.fn(async () => undefined),
    setTabMuted: vi.fn(async () => undefined),
    sleepTab: vi.fn(async () => true),
    wakeTab: vi.fn(async () => true),
    listClosedTabs: vi.fn(async () => [
      { url: 'https://example.com/a', title: '刚关掉的页面' }
    ]),
    reopenClosedAt: vi.fn(async () => 'new-id')
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('TabStrip', () => {
  beforeEach(() => installBsub());
  afterEach(cleanup);

  it('渲染标签标题，空标题回退为「新标签页」', () => {
    render(<TabStrip tabs={tabs} />);
    expect(screen.getByText('B 站首页')).toBeTruthy();
    expect(screen.getByText('新标签页')).toBeTruthy();
  });

  it('点击标签激活，点关闭调用 closeTab 并阻止冒泡', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    fireEvent.click(screen.getByText('B 站首页'));
    expect(api.activateTab).toHaveBeenCalledWith('t1');

    const closeButtons = screen.getAllByTitle('关闭标签页');
    fireEvent.click(closeButtons[1]);
    expect(api.closeTab).toHaveBeenCalledWith('t2');
    expect(api.activateTab).toHaveBeenCalledTimes(1);
  });

  it('中键关闭标签', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    fireEvent(screen.getByText('B 站首页'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(api.closeTab).toHaveBeenCalledWith('t1');
  });

  it('右键菜单可关闭其他与复制链接', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    fireEvent.contextMenu(screen.getByText('B 站首页'));
    fireEvent.click(screen.getByText('关闭其他'));
    expect(api.closeTab).toHaveBeenCalledWith('t2');
    expect(api.closeTab).toHaveBeenCalledWith('t3');
    expect(api.closeTab).not.toHaveBeenCalledWith('t1');

    fireEvent.contextMenu(screen.getByText('第三个'));
    fireEvent.click(screen.getByText('复制链接'));
    expect(api.writeClipboard).toHaveBeenCalledWith('https://example.org');
  });

  it('拖拽调整顺序调用 moveTab', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    const first = screen.getByText('B 站首页').closest('.tab') as HTMLElement;
    const third = screen.getByText('第三个').closest('.tab') as HTMLElement;
    fireEvent.dragStart(first);
    fireEvent.dragOver(third);
    fireEvent.drop(third);
    expect(api.moveTab).toHaveBeenCalledWith('t1', 2);
  });

  it('纵向模式可以搜索过滤标签', () => {
    render(<TabStrip tabs={tabs} vertical />);
    fireEvent.click(screen.getByTitle('搜索标签'));
    const input = screen.getByPlaceholderText('搜索标签…');
    fireEvent.change(input, { target: { value: '第三个' } });
    expect(screen.queryByText('B 站首页')).toBeNull();
    expect(screen.getByText('第三个')).toBeTruthy();
  });

  it('右键菜单可固定标签', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    fireEvent.contextMenu(screen.getByText('B 站首页'));
    fireEvent.click(screen.getByText('固定标签'));
    expect(api.pinTab).toHaveBeenCalledWith('t1', true);
  });

  it('已固定标签显示图钉并在菜单里可取消', () => {
    const api = installBsub();
    const pinned = [{ ...tabs[0], pinned: true }, ...tabs.slice(1)];
    render(<TabStrip tabs={pinned} />);
    expect(screen.getByTitle('已固定')).toBeTruthy();
    fireEvent.contextMenu(screen.getByText('B 站首页'));
    fireEvent.click(screen.getByText('取消固定'));
    expect(api.pinTab).toHaveBeenCalledWith('t1', false);
  });

  it('休眠标签带提示，新建与搜索按钮可用', () => {
    const api = installBsub();
    const onSearch = vi.fn();
    render(<TabStrip tabs={tabs} onSearch={onSearch} />);
    expect(screen.getByTitle(/已休眠/)).toBeTruthy();
    fireEvent.click(screen.getByTitle(/新建标签页/));
    expect(api.newTab).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/全局搜索/));
    expect(onSearch).toHaveBeenCalled();
  });
});

describe('TabStrip 增强', () => {
  afterEach(cleanup);

  it('Ctrl+点击多选，右键批量关闭', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} vertical />);
    fireEvent.click(screen.getByText('B 站首页'), { ctrlKey: true });
    fireEvent.click(screen.getByText('第三个'), { ctrlKey: true });
    fireEvent.contextMenu(screen.getByText('第三个'));
    fireEvent.click(screen.getByText('关闭所选（2）'));
    expect(api.closeTab).toHaveBeenCalledWith('t1');
    expect(api.closeTab).toHaveBeenCalledWith('t3');
    expect(api.activateTab).not.toHaveBeenCalled();
  });

  it('出声标签可以静音', () => {
    const api = installBsub();
    render(<TabStrip tabs={[{ ...tabs[0], audible: true }]} />);
    fireEvent.click(screen.getByTitle('静音此标签'));
    expect(api.setTabMuted).toHaveBeenCalledWith('t1', true);
    expect(api.activateTab).not.toHaveBeenCalled();
  });

  it('右键可以手动休眠', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    fireEvent.contextMenu(screen.getByText('第三个'));
    fireEvent.click(screen.getByText('休眠标签'));
    expect(api.sleepTab).toHaveBeenCalledWith('t3');
  });

  it('键盘上下切换标签', () => {
    const api = installBsub();
    const { container } = render(<TabStrip tabs={tabs} />);
    fireEvent.keyDown(container.querySelector('.tab-strip-list') as HTMLElement, {
      key: 'ArrowDown'
    });
    expect(api.activateTab).toHaveBeenCalledWith('t2');
  });

  it('标签操作菜单列出最近关闭并可恢复', async () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} vertical />);
    fireEvent.click(screen.getByTitle('标签操作'));
    const item = await screen.findByTitle('https://example.com/a');
    fireEvent.click(item);
    expect(api.reopenClosedAt).toHaveBeenCalledWith(0);
  });
});
