// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutBoard } from './ShortcutBoard';

const groups: Array<[string, Array<{ id: string; label: string; url: string; group: string }>]> = [
  [
    '常用',
    [
      { id: 'a', label: 'B 站', url: 'https://www.bilibili.com', group: '常用' },
      { id: 'b', label: '知乎', url: 'https://www.zhihu.com', group: '常用' }
    ]
  ]
];

function setup(overrides: Partial<React.ComponentProps<typeof ShortcutBoard>> = {}) {
  const props = {
    groups,
    visibleGroups: groups,
    total: 2,
    activeGroup: '全部',
    editMode: false,
    builtIn: [],
    onGroup: vi.fn(),
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onAdd: vi.fn(),
    onBatchAdd: vi.fn(),
    onRenameGroup: vi.fn(),
    onRemoveGroup: vi.fn(),
    onMove: vi.fn(),
    onMenu: vi.fn(),
    onDragStart: vi.fn(),
    density: 'comfortable' as const,
    onDensity: vi.fn(),
    collapsed: [] as string[],
    onToggleGroup: vi.fn(),
    frequent: [] as typeof groups[number][1],
    onExport: vi.fn(),
    onImport: vi.fn(),
    onImportBookmarks: vi.fn(),
    selected: [] as string[],
    onSelect: vi.fn(),
    onClearSelection: vi.fn(),
    onBatchDelete: vi.fn(),
    onBatchMove: vi.fn(),
    onNewGroupFrom: vi.fn(),
    tags: [] as Array<{ tag: string; count: number }>,
    activeTag: '',
    onTag: vi.fn(),
    onDetail: vi.fn(),
    ...overrides
  };
  render(<ShortcutBoard {...props} />);
  return props;
}

describe('ShortcutBoard', () => {
  afterEach(() => cleanup());

  it('按密度渲染类名', () => {
    setup({ density: 'compact' });
    expect(document.querySelector('.start-board')?.className).toContain('is-density-compact');
  });

  it('大分组先渲染 60 个，点击后显示更多', () => {
    const many = Array.from({ length: 70 }, (_, index) => ({
      id: `m${index}`,
      label: `站点${index}`,
      url: `https://example${index}.com`,
      group: '常用'
    }));
    const list: Array<[string, typeof many]> = [['常用', many]];
    setup({ groups: list, visibleGroups: list, total: 70 });
    expect(document.querySelectorAll('.start-tile').length).toBe(60);
    fireEvent.click(screen.getByText(/显示更多/));
    expect(document.querySelectorAll('.start-tile').length).toBe(70);
  });

  it('非编辑模式也能拖动排序', () => {
    const props = setup();
    const tiles = document.querySelectorAll('.start-tile');
    const transfer = {
      setData: vi.fn(),
      getData: () => 'a',
      effectAllowed: 'move'
    } as unknown as DataTransfer;
    fireEvent.dragStart(tiles[0], { dataTransfer: transfer });
    fireEvent.drop(tiles[1], { dataTransfer: transfer });
    expect(props.onMove).toHaveBeenCalledWith('a', '常用', 'b');
  });

  it('分组可以折叠，卡片从 DOM 移除', () => {
    const props = setup();
    expect(screen.getByText('B 站')).toBeTruthy();
    fireEvent.click(screen.getByTitle('折叠分组'));
    expect(props.onToggleGroup).toHaveBeenCalledWith('常用');
  });

  it('折叠状态隐藏卡片', () => {
    setup({ collapsed: ['常用'] });
    expect(screen.queryByText('B 站')).toBeNull();
  });

  it('标签行可以筛选，详情按钮回调', () => {
    const props = setup({
      tags: [{ tag: 'AI', count: 2 }],
      activeTag: 'AI'
    });
    expect(document.querySelector('.start-tag.is-active')?.textContent).toContain('AI');
    const allTag = [...document.querySelectorAll('.start-tag')].find((el) =>
      el.textContent?.includes('全部')
    ) as HTMLElement;
    fireEvent.click(allTag);
    expect(props.onTag).toHaveBeenCalledWith('');
    fireEvent.click(screen.getAllByTitle('查看详情')[0]);
    expect(props.onDetail).toHaveBeenCalled();
  });

});
