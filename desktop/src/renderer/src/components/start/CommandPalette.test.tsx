// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette, type PaletteCommand } from './CommandPalette';

function commands(run: (id: string) => void): PaletteCommand[] {
  return [
    { id: 'zen', group: '操作', label: '进入禅模式', hint: 'Esc', run: () => run('zen') },
    { id: 'settings', group: '页面', label: '设置', run: () => run('settings') },
    { id: 'notes', group: '小组件', label: '显示便签', run: () => run('notes') }
  ];
}

describe('CommandPalette', () => {
  afterEach(cleanup);

  it('展示分组并可以过滤', () => {
    render(<CommandPalette open commands={commands(() => undefined)} onClose={() => undefined} />);
    expect(screen.getByText('操作')).toBeTruthy();
    expect(screen.getByText('页面')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('指令面板搜索'), { target: { value: '设置' } });
    expect(screen.queryByText('进入禅模式')).toBeNull();
    expect(screen.getByText('设置')).toBeTruthy();
  });

  it('回车执行当前命令并关闭', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands(run)} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('zen');
    expect(onClose).toHaveBeenCalled();
  });

  it('方向键切换选中项', () => {
    const run = vi.fn();
    render(<CommandPalette open commands={commands(run)} onClose={() => undefined} />);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('settings');
  });

  it('输入内容时生成动态搜索命令并优先执行', () => {
    const run = vi.fn();
    render(
      <CommandPalette
        open
        commands={commands(() => undefined)}
        buildQueryCommands={(value) =>
          value.trim()
            ? [{ id: 'search', group: '搜索', label: `搜索 ${value}`, run: () => run('search') }]
            : []
        }
        onClose={() => undefined}
      />
    );
    fireEvent.change(screen.getByLabelText('指令面板搜索'), { target: { value: '拾字' } });
    expect(screen.getByText('搜索 拾字')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('search');
  });

  it('Esc 关闭，没有匹配时显示空态', () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands(() => undefined)} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('指令面板搜索'), { target: { value: 'zzz' } });
    expect(screen.getByText('没有匹配的命令')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
