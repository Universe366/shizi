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
    ...overrides
  };
  render(<ShortcutBoard {...props} />);
  return props;
}

describe('ShortcutBoard', () => {
  afterEach(() => cleanup());

  it('按密度渲染类名，密度按钮回调', () => {
    const props = setup({ density: 'compact' });
    expect(document.querySelector('.start-board')?.className).toContain('is-density-compact');
    fireEvent.click(screen.getByText('大图标'));
    expect(props.onDensity).toHaveBeenCalledWith('large');
  });

  it('分组可以折叠，卡片从 DOM 移除', () => {
    const props = setup();
    expect(screen.getByText('B 站')).toBeTruthy();
    fireEvent.click(screen.getByTitle('折叠分组'));
    expect(props.onToggleGroup).toHaveBeenCalledWith('常用');
    fireEvent.click(screen.getByTitle('导出起始页'));
    expect(props.onExport).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('导入起始页'));
    expect(props.onImport).toHaveBeenCalled();
  });

  it('折叠状态隐藏卡片', () => {
    setup({ collapsed: ['常用'] });
    expect(screen.queryByText('B 站')).toBeNull();
  });

  it('有常用数据时显示常用标签', () => {
    const props = setup({ frequent: groups[0][1] });
    const tab = [...document.querySelectorAll('.start-tab')].find((el) =>
      el.textContent?.includes('常用')
    ) as HTMLElement;
    fireEvent.click(tab);
    expect(props.onGroup).toHaveBeenCalledWith('常用');
  });
});
