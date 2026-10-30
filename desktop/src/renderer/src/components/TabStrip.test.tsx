// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TabGroup, TabInfo } from '../../../shared/types';
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
    duplicateTab: vi.fn(async () => 'dup-id'),
    reloadTab: vi.fn(),
    moveTab: vi.fn(async () => undefined),
    moveTabs: vi.fn(async () => undefined),
    newTab: vi.fn(),
    writeClipboard: vi.fn(async () => ({ ok: true })),
    pinTab: vi.fn(async () => undefined),
    setTabMuted: vi.fn(async () => undefined),
    sleepTab: vi.fn(async () => true),
    wakeTab: vi.fn(async () => true),
    listClosedTabs: vi.fn(async () => [
      { url: 'https://example.com/a', title: '刚关掉的页面' }
    ]),
    reopenClosedAt: vi.fn(async () => 'new-id'),
    getTabGroups: vi.fn(async () => [] as TabGroup[]),
    onTabGroups: vi.fn(() => () => undefined),
    toggleTabGroupCollapsed: vi.fn(async () => undefined),
    tabPreview: vi.fn(async (_id: string) => ({
      dataUrl: 'data:image/png;base64,AAAA',
      title: '预览',
      url: 'https://example.com'
    }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('TabStrip', () => {
  beforeEach(() => {
    localStorage.clear();
    installBsub();
  });
  afterEach(cleanup);

  it('渲染标签标题，空标题回退为「新标签页」', () => {
    render(<TabStrip tabs={tabs} />);
    expect(screen.getByText('B 站首页')).toBeTruthy();
    expect(screen.getByText('新标签页')).toBeTruthy();
  });

  it('点击标签激活，点关闭调用 closeTab 并阻止冒泡', () => {
    const api = installBsub();
    const onActivate = vi.fn();
    render(<TabStrip tabs={tabs} onActivate={onActivate} />);
    fireEvent.click(screen.getByText('B 站首页'));
    expect(api.activateTab).toHaveBeenCalledWith('t1');
    expect(onActivate).toHaveBeenCalledWith('t1');

    const closeButtons = screen.getAllByTitle('关闭标签页');
    fireEvent.click(closeButtons[1]);
    // 关闭时带上视觉上的右邻居，主进程不会跳到固定区/分组里的标签。
    expect(api.closeTab).toHaveBeenCalledWith('t2', 't3');
    expect(api.activateTab).toHaveBeenCalledTimes(1);
  });

  it('中键关闭标签', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} />);
    fireEvent(screen.getByText('B 站首页'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(api.closeTab).toHaveBeenCalledWith('t1', 't2');
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
    expect(api.writeClipboard).toHaveBeenCalledWith('https://example.org/');
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

  it('多选后拖拽整组标签', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} vertical />);
    fireEvent.click(screen.getByText('B 站首页'), { ctrlKey: true });
    fireEvent.click(screen.getByText('第三个'), { ctrlKey: true });
    const first = screen.getByText('B 站首页').closest('.tab') as HTMLElement;
    const second = screen.getByText('新标签页').closest('.tab') as HTMLElement;
    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    fireEvent.drop(second);
    expect(api.moveTabs).toHaveBeenCalledWith(['t1', 't3'], expect.any(Number));
  });

  it('折叠轨道标签直接带关闭按钮，且不再显示无用的加号', () => {
    localStorage.setItem('tabs.collapsed', '1');
    const api = installBsub();
    const { container } = render(<TabStrip tabs={tabs} vertical />);
    expect(screen.queryByTitle('新建标签页（Ctrl+T）')).toBeNull();
    fireEvent.click(container.querySelector('.tab-close') as HTMLElement);
    expect(api.closeTab).toHaveBeenCalled();
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
  beforeEach(() => {
    localStorage.clear();
    installBsub();
  });
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

  it('标签菜单支持复制、重新加载与关闭左侧', () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} vertical />);
    fireEvent.contextMenu(screen.getByText('第三个'));
    fireEvent.click(screen.getByText('复制标签页'));
    expect(api.duplicateTab).toHaveBeenCalledWith('t3');

    fireEvent.contextMenu(screen.getByText('第三个'));
    fireEvent.click(screen.getByText('重新加载'));
    expect(api.reloadTab).toHaveBeenCalledWith('t3');

    fireEvent.contextMenu(screen.getByText('第三个'));
    fireEvent.click(screen.getByText('关闭左侧'));
    expect(api.closeTab).toHaveBeenCalledWith('t1');
    expect(api.closeTab).toHaveBeenCalledWith('t2');
  });

  it('可以在操作菜单关闭重复标签', async () => {
    const api = installBsub();
    const duplicated = [...tabs, { ...tabs[0], id: 't4', active: false }];
    render(<TabStrip tabs={duplicated} vertical />);
    fireEvent.click(screen.getByTitle('标签操作'));
    fireEvent.click(await screen.findByText(/关闭重复标签/));
    expect(api.closeTab).toHaveBeenCalledWith('t4');
  });

  it('标签操作菜单可以关闭全部标签', async () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} vertical />);
    fireEvent.click(screen.getByTitle('标签操作'));
    fireEvent.click(await screen.findByText('关闭全部标签'));
    expect(api.closeTab).toHaveBeenCalledTimes(3);
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

describe('TabStrip 垂直栏回归', () => {
  beforeEach(() => {
    localStorage.clear();
    installBsub();
  });
  afterEach(cleanup);

  it('分组数据未到时，带 groupId 的标签仍然显示', async () => {
    const grouped = [{ ...tabs[0], groupId: 'g1' }, tabs[1]];
    render(<TabStrip tabs={grouped} vertical />);
    expect(screen.getByText('B 站首页')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('新标签页')).toBeTruthy());
  });

  it('搜索时自动展开折叠分组，清空搜索后恢复', async () => {
    const api = installBsub();
    const group = { id: 'g1', name: '研究', color: 'purple', collapsed: true } as TabGroup;
    api.getTabGroups.mockResolvedValue([group]);
    render(<TabStrip tabs={[{ ...tabs[0], groupId: 'g1' }, tabs[2]]} vertical />);
    await waitFor(() => expect(screen.getByText('研究')).toBeTruthy());
    expect(screen.queryByText('B 站首页')).toBeNull();

    fireEvent.click(screen.getByTitle('搜索标签'));
    fireEvent.change(screen.getByPlaceholderText('搜索标签…'), { target: { value: 'B 站' } });
    expect(screen.getByText('B 站首页')).toBeTruthy();
  });

  it('键盘按视觉顺序走：分组标签排在普通标签之后', async () => {
    const api = installBsub();
    api.getTabGroups.mockResolvedValue([
      { id: 'g1', name: '研究', color: 'blue', collapsed: false } as TabGroup
    ]);
    const grouped = [{ ...tabs[0] }, { ...tabs[1], groupId: 'g1' }, { ...tabs[2] }];
    const { container } = render(<TabStrip tabs={grouped} vertical />);
    await waitFor(() => expect(screen.getByText('研究')).toBeTruthy());

    fireEvent.keyDown(container.querySelector('.tab-strip-list') as HTMLElement, {
      key: 'ArrowDown'
    });
    // 视觉顺序是 B 站首页 → 第三个 →（分组）新标签页，不是后端数组顺序。
    expect(api.activateTab).toHaveBeenCalledWith('t3');
  });

  it('关闭标签时把视觉上的下一个标签传给主进程', async () => {
    const api = installBsub();
    api.getTabGroups.mockResolvedValue([
      { id: 'g1', name: '研究', color: 'blue', collapsed: false } as TabGroup
    ]);
    const grouped = [{ ...tabs[0] }, { ...tabs[1], groupId: 'g1' }, { ...tabs[2] }];
    render(<TabStrip tabs={grouped} vertical />);
    await waitFor(() => expect(screen.getByText('研究')).toBeTruthy());

    const third = screen.getByText('第三个').closest('.tab') as HTMLElement;
    fireEvent.click(third.querySelector('.tab-close') as HTMLElement);
    expect(api.closeTab).toHaveBeenCalledWith('t3', 't2');
  });

  it('折叠栏悬停 140ms 后展开，移出收起', async () => {
    localStorage.setItem('tabs.collapsed', '1');
    const onPeekChange = vi.fn();
    const { container } = render(
      <TabStrip tabs={tabs} vertical onPeekChange={onPeekChange} />
    );
    const strip = container.querySelector('.tab-strip') as HTMLElement;
    expect(strip.classList.contains('is-peeking')).toBe(false);

    fireEvent.mouseEnter(strip);
    await new Promise((resolve) => setTimeout(resolve, 240));
    expect(strip.classList.contains('is-peeking')).toBe(true);
    expect(onPeekChange).toHaveBeenCalledWith(true, expect.any(Number));

    fireEvent.mouseLeave(strip);
    expect(strip.classList.contains('is-peeking')).toBe(false);
  });

  it('悬停显示预览，快速移出不会残留预览', async () => {
    const api = installBsub();
    render(<TabStrip tabs={tabs} vertical />);
    const first = screen.getByText('B 站首页').closest('.tab') as HTMLElement;

    fireEvent.mouseEnter(first);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(document.querySelector('.tab-preview')).toBeTruthy();
    expect(api.tabPreview).toHaveBeenCalledWith('t1');

    fireEvent.mouseLeave(first);
    expect(document.querySelector('.tab-preview')).toBeNull();

    // 450ms 的预览定时器在鼠标移出时必须被取消。
    fireEvent.mouseEnter(first);
    await new Promise((resolve) => setTimeout(resolve, 100));
    fireEvent.mouseLeave(first);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(document.querySelector('.tab-preview')).toBeNull();
  });

  it('关闭搜索会清掉过滤条件', () => {
    render(<TabStrip tabs={tabs} vertical />);
    fireEvent.click(screen.getByTitle('搜索标签'));
    fireEvent.change(screen.getByPlaceholderText('搜索标签…'), {
      target: { value: '第三个' }
    });
    expect(screen.queryByText('B 站首页')).toBeNull();

    fireEvent.click(screen.getByTitle('搜索标签'));
    expect(screen.getByText('B 站首页')).toBeTruthy();
    expect(screen.queryByPlaceholderText('搜索标签…')).toBeNull();
  });
});
