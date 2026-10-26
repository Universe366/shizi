// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CloseDialog } from './CloseDialog';

function installBsub() {
  const api = { closeShown: vi.fn(), closeDecision: vi.fn() };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

afterEach(cleanup);

describe('CloseDialog', () => {
  it('显示时通知主进程取消「弹窗没出来」的兜底计时', () => {
    const api = installBsub();
    render(<CloseDialog open onChoose={() => {}} />);
    expect(screen.getByText('要关闭拾字吗？')).toBeTruthy();
    expect(api.closeShown).toHaveBeenCalledTimes(1);
  });

  it('关闭状态下不渲染也不通知', () => {
    const api = installBsub();
    render(<CloseDialog open={false} onChoose={() => {}} />);
    expect(screen.queryByText('要关闭拾字吗？')).toBeNull();
    expect(api.closeShown).not.toHaveBeenCalled();
  });

  it('取消回传 cancel', () => {
    installBsub();
    const onChoose = vi.fn();
    render(<CloseDialog open onChoose={onChoose} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onChoose).toHaveBeenLastCalledWith('cancel', false);
  });

  it('最小化回传 tray', () => {
    installBsub();
    const onChoose = vi.fn();
    render(<CloseDialog open onChoose={onChoose} />);
    fireEvent.click(screen.getByText('最小化到托盘'));
    expect(onChoose).toHaveBeenLastCalledWith('tray', false);
  });

  it('Esc 等于取消', () => {
    installBsub();
    const onChoose = vi.fn();
    render(<CloseDialog open onChoose={onChoose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChoose).toHaveBeenLastCalledWith('cancel', false);
  });
});
