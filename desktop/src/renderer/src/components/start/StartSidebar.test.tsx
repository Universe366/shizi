// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartSidebar } from './StartSidebar';

const groups: Array<[string, Array<{ id: string; label: string; url: string; group: string }>]> = [
  ['常用', [{ id: 'a', label: 'B 站', url: 'https://www.bilibili.com', group: '常用' }]],
  ['学习', [{ id: 'b', label: 'MDN', url: 'https://developer.mozilla.org', group: '学习' }]]
];

function setup(overrides: Partial<Parameters<typeof StartSidebar>[0]> = {}) {
  const props = {
    groups,
    total: 2,
    activeGroup: '全部',
    onGroup: vi.fn(),
    density: 'comfortable' as const,
    onDensity: vi.fn(),
    selected: [] as string[],
    onClearSelection: vi.fn(),
    onBatchDelete: vi.fn(),
    onBatchMove: vi.fn(),
    onNewGroupFrom: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onImportBookmarks: vi.fn(),
    onBatchAdd: vi.fn(),
    onAdd: vi.fn(),
    frequent: groups[0][1],
    onMove: vi.fn(),
    ...overrides
  };
  render(<StartSidebar {...props} />);
  return props;
}

describe('StartSidebar', () => {
  afterEach(() => cleanup());

  it('密度与导入导出在侧栏', () => {
    const props = setup();
    fireEvent.click(screen.getByText('大图标'));
    expect(props.onDensity).toHaveBeenCalledWith('large');
    fireEvent.click(screen.getByTitle('导出起始页'));
    expect(props.onExport).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('导入起始页'));
    expect(props.onImport).toHaveBeenCalled();
  });

  it('常用分组可切换', () => {
    const props = setup();
    const tab = [...document.querySelectorAll('.start-tab')].find((el) =>
      el.textContent?.includes('常用')
    ) as HTMLElement;
    fireEvent.click(tab);
    expect(props.onGroup).toHaveBeenCalledWith('常用');
  });

  it('拖入分组标签会移动卡片', () => {
    const props = setup();
    const tab = [...document.querySelectorAll('.start-tab')].find((el) =>
      el.textContent?.includes('学习')
    ) as HTMLElement;
    const transfer = {
      setData: vi.fn(),
      getData: () => 'a',
      effectAllowed: 'move'
    } as unknown as DataTransfer;
    fireEvent.drop(tab, { dataTransfer: transfer });
    expect(props.onMove).toHaveBeenCalledWith('a', '学习');
  });
});
