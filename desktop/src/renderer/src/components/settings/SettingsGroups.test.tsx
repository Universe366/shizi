// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppSettings } from '../../../../shared/types';
import { AddressSearchGroup } from './AddressSearchGroup';
import { AppearanceGroup } from './AppearanceGroup';
import { ReadingGroup } from './ReadingGroup';
import { SessionsGroup } from './SessionsGroup';

const value = {
  theme: 'system',
  closeToTray: true,
  suspendMinutes: 5,
  cacheSubtitles: true,
  subtitleCacheDays: 30,
  fontScale: 1,
  sidebarWidth: 300,
  sidebarPosition: 'left',
  sidebarCollapsed: false,
  autoFollow: true,
  wizardDone: false,
  restoreSession: true,
  selectionToolbar: true,
  searchEngine: 'bilibili',
  searchEngineCustom: '',
  verticalTabs: false,
  petEnabled: false,
  assistantEnabled: false,
  petX: 0,
  petY: 0
} as AppSettings['general'];

function props(overrides: Record<string, unknown> = {}) {
  return { value, onChange: vi.fn(), ...overrides };
}

function Groups({ value, onChange }: { value: AppSettings['general']; onChange: (patch: Partial<AppSettings['general']>) => void }) {
  return (
    <>
      <AppearanceGroup value={value} onChange={onChange} />
      <SessionsGroup value={value} onChange={onChange} />
      <AddressSearchGroup value={value} onChange={onChange} />
      <ReadingGroup value={value} onChange={onChange} />
    </>
  );
}

describe('GeneralSection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('渲染主题与侧栏位置', () => {
    render(<Groups {...props()} />);
    expect(
      screen.getByRole('button', { name: '主题：跟随系统' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '侧栏位置：左侧' }).getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('切换主题、侧栏位置与开关都回传局部补丁', () => {
    const p = props();
    render(<Groups {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '主题：深色' }));
    expect(p.onChange).toHaveBeenCalledWith({ theme: 'dark' });
    fireEvent.click(screen.getByRole('button', { name: '侧栏位置：右侧' }));
    expect(p.onChange).toHaveBeenCalledWith({ sidebarPosition: 'right' });
    fireEvent.click(screen.getByLabelText('关闭窗口时缩到托盘'));
    expect(p.onChange).toHaveBeenCalledWith({ closeToTray: false });
  });

  it('垂直标签栏开关回传补丁', () => {
    const p = props();
    render(<Groups {...p} />);
    fireEvent.click(screen.getByLabelText(/垂直标签栏/));
    expect(p.onChange).toHaveBeenCalledWith({ verticalTabs: true });
  });

  it('开机自启动开关回传补丁', () => {
    const p = props();
    render(<Groups {...p} />);
    fireEvent.click(screen.getByLabelText(/开机自动启动/));
    expect(p.onChange).toHaveBeenCalledWith({ autoStart: true });
  });

  it('侧栏宽度滑杆范围 240–480', () => {
    const p = props();
    render(<Groups {...p} />);
    const width = screen.getByLabelText('侧栏宽度') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '999' } });
    expect(p.onChange).toHaveBeenCalledWith({ sidebarWidth: 480 });
    fireEvent.change(width, { target: { value: '100' } });
    expect(p.onChange).toHaveBeenCalledWith({ sidebarWidth: 240 });
  });

  it('关闭字幕缓存后隐藏天数输入', () => {
    const p = props({ value: { ...value, cacheSubtitles: false } });
    render(<Groups {...p} />);
    expect(screen.queryByText(/字幕缓存天数/)).toBeNull();
  });

  it('字号滑杆显示百分比', () => {
    render(<Groups {...props({ value: { ...value, fontScale: 1.25 } })} />);
    expect(screen.getByText(/界面字号（125%）/)).toBeTruthy();
  });
});
