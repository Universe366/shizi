// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StartShortcut } from '../../../../shared/types';
import { Dock } from './Dock';

const shortcuts: StartShortcut[] = [
  { id: 'a', label: 'B 站', url: 'https://bilibili.com' },
  { id: 'b', label: 'YouTube', url: 'https://youtube.com' }
];
const candidate: StartShortcut = { id: 'c', label: 'GitHub', url: 'https://github.com' };

function props(overrides: Record<string, unknown> = {}) {
  return {
    shortcuts,
    builtIn: [],
    weather: null,
    pomodoro: { phase: 'work' as const, left: 1500, running: false, onToggle: vi.fn() },
    zen: false,
    onOpenShortcut: vi.fn(),
    onReorder: vi.fn(),
    onMenu: vi.fn(),
    onBuiltIn: vi.fn(),
    onPalette: vi.fn(),
    onZen: vi.fn(),
    editing: true,
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    candidates: [candidate],
    onAdd: vi.fn(),
    ...overrides
  };
}

describe('Dock', () => {
  afterEach(cleanup);

  it('编辑态可以添加候选站点', () => {
    const p = props();
    render(<Dock {...p} />);
    fireEvent.click(screen.getByTitle('添加常用站点到 Dock'));
    fireEvent.click(screen.getByText('GitHub'));
    expect(p.onAdd).toHaveBeenCalledWith('c');
  });

  it('可以把网格图标拖到 Dock 上', () => {
    const p = props();
    render(<Dock {...p} />);
    const raw: Record<string, string> = { 'application/x-shizi-shortcut': 'c' };
    const dataTransfer = {
      setData: vi.fn(),
      getData: (key: string) => raw[key] || '',
      effectAllowed: 'move'
    };
    fireEvent.drop(screen.getByLabelText('B 站'), { dataTransfer });
    expect(p.onAdd).toHaveBeenCalledWith('c');
  });

  it('拖拽 Dock 图标可以调整顺序', () => {
    const p = props();
    render(<Dock {...p} />);
    const raw: Record<string, string> = {};
    const dataTransfer = {
      setData: (key: string, value: string) => { raw[key] = value; },
      getData: (key: string) => raw[key] || '',
      effectAllowed: 'move'
    };
    fireEvent.dragStart(screen.getByLabelText('B 站'), { dataTransfer });
    fireEvent.drop(screen.getByLabelText('YouTube'), { dataTransfer });
    expect(p.onReorder).toHaveBeenCalledWith('a', 'b');
  });
});
