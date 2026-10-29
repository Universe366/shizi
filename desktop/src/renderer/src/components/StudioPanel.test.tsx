// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudioPanel } from './StudioPanel';

function installBsub() {
  const api = {
    listExports: vi.fn(async () => ({ ok: true as const, data: [] })),
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: { settings: { general: { subtitleStyle: {}, subtitlePresets: [] } } }
    })),
    saveSettings: vi.fn(async () => ({ ok: true as const })),
    onSynthesizeDone: vi.fn(() => () => undefined),
    onLocalTransProgress: vi.fn(() => () => undefined),
    onLocalTransDone: vi.fn(() => () => undefined),
    onLocalTransError: vi.fn(() => () => undefined),
    onTranslateProgress: vi.fn(() => () => undefined),
    onTranslateDone: vi.fn(() => () => undefined),
    onTranslateError: vi.fn(() => () => undefined),
    onOptimizeProgress: vi.fn(() => () => undefined),
    onOptimizeDone: vi.fn(() => () => undefined),
    onOptimizeError: vi.fn(() => () => undefined),
    onSynthesizeProgress: vi.fn(() => () => undefined),
    onSynthesizeError: vi.fn(() => () => undefined)
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('StudioPanel', () => {
  afterEach(cleanup);

  it('渲染任务 / 字幕 / 样式 / 合成 / 记录导航', () => {
    installBsub();
    render(<StudioPanel />);
    const labels = Array.from(document.querySelectorAll('.studio-nav-item')).map((node) =>
      node.textContent?.replace(/\d+/g, '').trim()
    );
    expect(labels).toEqual(['任务', '字幕', '样式', '合成', '批量', '记录']);
    expect(screen.getByText('选择本地视频 / 音频')).toBeTruthy();
    expect(document.querySelector('.studio-table')).toBeNull();
  });

  it('切到字幕页显示空状态', () => {
    installBsub();
    render(<StudioPanel />);
    fireEvent.click(screen.getByText('字幕'));
    expect(screen.getByText('还没有字幕')).toBeTruthy();
  });

  it('转录完成后进入可编辑字幕表', async () => {
    const api = installBsub();
    let done: ((event: {
      requestId: string;
      lines: Array<{ start: number; end: number; text: string }>;
      name: string;
      duration: number;
      path: string;
    }) => void) | null = null;
    (api.onLocalTransDone as unknown as {
      mockImplementation: (fn: (cb: typeof done) => () => void) => void;
    }).mockImplementation((cb) => {
      done = cb;
      return () => undefined;
    });
    render(<StudioPanel />);
    act(() => {
      done?.({
        requestId: 'r',
        lines: [
          { start: 0, end: 2, text: '第一行' },
          { start: 2, end: 4, text: '第二行' }
        ],
        name: 'a.mp4',
        duration: 4,
        path: 'C:/a.mp4'
      });
    });
    await waitFor(() => expect(document.querySelectorAll('.studio-table-row')).toHaveLength(2));
    const input = document.querySelector('.studio-table-row input') as HTMLInputElement;
    expect(input.value).toBe('第一行');
    fireEvent.change(input, { target: { value: '改过' } });
    expect(input.value).toBe('改过');
    const remove = document.querySelector('.studio-row-actions .is-danger') as HTMLElement;
    expect(remove).toBeTruthy();
    fireEvent.click(remove);
    expect(document.querySelectorAll('.studio-table-row')).toHaveLength(1);
  });

  it('切到样式页显示预览与保存按钮', () => {
    installBsub();
    render(<StudioPanel />);
    fireEvent.click(screen.getByText('样式'));
    expect(screen.getByText('保存为默认')).toBeTruthy();
    expect(document.querySelector('.studio-style-preview')).toBeTruthy();
  });
});
