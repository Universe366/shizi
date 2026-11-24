// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings, BridgeStatus } from '../../../../shared/types';
import { BridgeSection } from './BridgeSection';

const value = { enabled: true, port: 47821, token: 'token-123' } as AppSettings['bridge'];

function props(overrides: Record<string, unknown> = {}) {
  return {
    value,
    status: { running: true, port: 47821 } as BridgeStatus,
    installing: false,
    onChange: vi.fn(),
    onInstall: vi.fn(),
    ...overrides
  };
}

describe('BridgeSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('只显示运行状态，不再暴露端口与 Token', () => {
    render(<BridgeSection {...props()} />);
    expect(screen.getByText(/运行中 · 127.0.0.1:47821/)).toBeTruthy();
    expect(screen.queryByText('token-123')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('未运行时显示原因', () => {
    render(<BridgeSection {...props({ status: { running: false, error: '端口被占用' } })} />);
    expect(screen.getByText(/未启动：端口被占用/)).toBeTruthy();
  });

  it('开关回传补丁', () => {
    const p = props();
    render(<BridgeSection {...p} />);
    fireEvent.click(screen.getByLabelText('启用本机接收'));
    expect(p.onChange).toHaveBeenCalledWith({ ...value, enabled: false });
  });

  it('安装按钮可点击，安装中禁用', () => {
    const p = props();
    const { rerender } = render(<BridgeSection {...p} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(p.onInstall).toHaveBeenCalled();

    rerender(<BridgeSection {...props({ installing: true })} />);
    expect((screen.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
