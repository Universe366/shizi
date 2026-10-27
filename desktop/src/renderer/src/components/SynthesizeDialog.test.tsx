// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SubtitleLine } from '../../../shared/types';
import { DEFAULT_SUBTITLE_STYLE } from '../../../shared/ass';
import { SynthesizeDialog } from './SynthesizeDialog';

const lines: SubtitleLine[] = [
  { start: 0, end: 2, text: '第一句字幕' },
  { start: 2, end: 4, text: '第二句字幕' }
];

function installBsub() {
  const api = {
    getSettings: vi.fn(async () => ({
      ok: true as const,
      data: {
        settings: {
          general: {
            subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 48, primaryColor: '#ffd166' },
            subtitlePresets: [{ name: '小字', style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 32 } }]
          }
        },
        version: '0.39.4'
      }
    })),
    saveSettings: vi.fn(async (next: unknown) => ({ ok: true as const, data: { settings: next } })),
    synthesizeVideo: vi.fn(async (_payload: unknown) => ({
      ok: true as const,
      data: { requestId: 'r1', path: 'C:/tmp/out.mp4' }
    }))
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

const props = () => ({
  open: true,
  videoPath: 'C:/videos/demo.mp4',
  title: '演示',
  lines,
  translated: null,
  onClose: vi.fn()
});

describe('SynthesizeDialog', () => {
  afterEach(cleanup);

  it('打开后读到默认样式并渲染预览', async () => {
    installBsub();
    render(<SynthesizeDialog {...props()} />);
    expect(await screen.findByText('第一句字幕')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/48px/)).toBeTruthy());
  });

  it('改字号后预览与实际提交都跟随', async () => {
    const api = installBsub();
    render(<SynthesizeDialog {...props()} />);
    const size = (await screen.findByDisplayValue('48')) as HTMLInputElement;
    fireEvent.change(size, { target: { value: '60' } });
    expect(screen.getByText(/60px/)).toBeTruthy();
    fireEvent.click(screen.getByText('开始合成'));
    await waitFor(() => expect(api.synthesizeVideo).toHaveBeenCalled());
    const payload = api.synthesizeVideo.mock.calls.at(-1)?.[0] as unknown as {
      mode: string;
      style: { fontSize: number };
    };
    expect(payload.mode).toBe('hard');
    expect(payload.style.fontSize).toBe(60);
  });

  it('软字幕可指定轨道语言', async () => {
    const api = installBsub();
    render(<SynthesizeDialog {...props()} />);
    fireEvent.click(screen.getByText(/MKV · 可开关/));
    fireEvent.change(screen.getByDisplayValue('中文'), { target: { value: 'eng' } });
    fireEvent.click(screen.getByText('开始合成'));
    await waitFor(() => expect(api.synthesizeVideo).toHaveBeenCalled());
    const payload = api.synthesizeVideo.mock.calls.at(-1)?.[0] as unknown as {
      mode: string;
      softLanguage: string;
    };
    expect(payload.mode).toBe('soft');
    expect(payload.softLanguage).toBe('eng');
  });

  it('没有译文时双语不可勾选', async () => {
    installBsub();
    render(<SynthesizeDialog {...props()} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('套用预设会更新字号', async () => {
    installBsub();
    render(<SynthesizeDialog {...props()} />);
    await waitFor(() => expect(document.querySelectorAll('option').length).toBeGreaterThan(1));
    const select = [...document.querySelectorAll('select')].find((item) =>
      item.textContent?.includes('样式预设')
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '小字' } });
    await waitFor(() => expect(screen.getByText(/32px/)).toBeTruthy());
  });
});
  it('预览跟随位置与颜色，软字幕提示 ASS', async () => {
    installBsub();
    render(<SynthesizeDialog {...props()} />);
    await screen.findByDisplayValue('48');
    const caption = document.querySelector('.synth-preview-caption') as HTMLElement;
    expect(caption.style.alignItems).toBe('flex-end');
    const select = document.querySelector('.synth-field select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '8' } });
    expect(caption.style.alignItems).toBe('flex-start');
    fireEvent.click(screen.getByText(/MKV · 可开关/));
    expect(screen.getByText(/MKV 软字幕（ASS）/)).toBeTruthy();
  });
