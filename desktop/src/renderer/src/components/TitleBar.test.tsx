// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TitleBar } from './TitleBar';

describe('TitleBar', () => {
  afterEach(cleanup);

  it('置顶、最小化、最大化、关闭都回传动作', () => {
    const onTogglePinned = vi.fn();
    const onToggleMaximize = vi.fn();
    const minimizeWindow = vi.fn(() => Promise.resolve({ ok: true, data: true }));
    const requestClose = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, 'bsub', {
      configurable: true,
      value: { minimizeWindow, requestClose }
    });

    const view = render(
      <TitleBar
        pinned={false}
        onTogglePinned={onTogglePinned}
        maximized={false}
        onToggleMaximize={onToggleMaximize}
      />
    );

    fireEvent.click(screen.getByTitle('窗口置顶'));
    expect(onTogglePinned).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('最小化'));
    expect(minimizeWindow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('最大化'));
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('关闭'));
    expect(requestClose).toHaveBeenCalledTimes(1);

    view.rerender(
      <TitleBar
        pinned
        onTogglePinned={onTogglePinned}
        maximized
        onToggleMaximize={onToggleMaximize}
      />
    );
    expect(screen.getByTitle('取消窗口置顶')).toBeTruthy();
    expect(screen.getByTitle('还原')).toBeTruthy();
  });
});
