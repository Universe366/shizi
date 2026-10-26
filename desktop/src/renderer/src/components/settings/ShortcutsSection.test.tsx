// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsSection } from './ShortcutsSection';

function general(overrides: Record<string, unknown> = {}) {
  return {
    petShortcut: true,
    petVoiceShortcut: true,
    petChatShortcut: true,
    shortcuts: {},
    ...overrides
  } as never;
}

function installBsub() {
  const api = {
    petShortcutsStatus: vi.fn(async () => [
      { id: 'shot', accelerator: 'Control+Alt+S', registered: true, error: '' },
      { id: 'voice', accelerator: 'Control+Shift+Space', registered: true, error: '' },
      { id: 'chat', accelerator: 'Control+Shift+E', registered: true, error: '' }
    ])
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

afterEach(cleanup);

describe('ShortcutsSection', () => {
  it('列出可自定义动作和固定键位', async () => {
    installBsub();
    render(<ShortcutsSection value={general()} onChange={vi.fn()} />);
    expect(screen.getAllByText('Ctrl + Shift + P').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ctrl + Shift + 2').length).toBeGreaterThan(0);
    expect(screen.getByText('打开面板：总结')).toBeTruthy();
    expect(screen.getByText('F11')).toBeTruthy();
    expect(await screen.findByText(/已注册：Control\+Alt\+S/)).toBeTruthy();
  });

  it('录制新快捷键并写回覆盖值', () => {
    installBsub();
    const onChange = vi.fn();
    render(<ShortcutsSection value={general()} onChange={onChange} />);
    const row = screen.getByText('新建标签页').closest('.shortcut-row') as HTMLElement;
    fireEvent.click(row.querySelector('button') as HTMLButtonElement);
    fireEvent.keyDown(window, {
      key: 'N',
      code: 'KeyN',
      ctrlKey: true,
      altKey: true,
      bubbles: true
    });
    expect(onChange).toHaveBeenCalledWith({ shortcuts: { 'new-tab': 'Ctrl+Alt+KeyN' } });
  });

  it('重复绑定会提示且不写入', () => {
    installBsub();
    const onChange = vi.fn();
    render(<ShortcutsSection value={general()} onChange={onChange} />);
    const row = screen.getByText('新建标签页').closest('.shortcut-row') as HTMLElement;
    fireEvent.click(row.querySelector('button') as HTMLButtonElement);
    // Ctrl+KeyK 已经是「全局搜索」
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/已经被「全局搜索」占用/)).toBeTruthy();
  });

  it('全局快捷键可以关闭', () => {
    installBsub();
    const onChange = vi.fn();
    render(<ShortcutsSection value={general()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/框选截图 Ctrl \+ Alt \+ S/));
    expect(onChange).toHaveBeenCalledWith({ petShortcut: false });
  });

  it('恢复默认会删掉该动作的覆盖值', () => {
    installBsub();
    const onChange = vi.fn();
    render(
      <ShortcutsSection
        value={general({ shortcuts: { 'new-tab': 'Ctrl+Alt+KeyN' } })}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getAllByText('恢复默认')[0]);
    expect(onChange).toHaveBeenCalledWith({ shortcuts: {} });
  });
});
