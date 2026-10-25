// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_CONTROL_SCRIPT } from './mediaControl';

type MediaApi = {
  setState: (next: Record<string, unknown>) => void;
  getState: () => { rate: number; pitch: boolean; panel: boolean; singleKey: boolean };
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  destroy: () => void;
};

function api(): MediaApi {
  return (window as unknown as { __shiziMedia: MediaApi }).__shiziMedia;
}

function shadow(): ShadowRoot {
  const host = document.getElementById('__shizi_media_ui__');
  if (!host?.shadowRoot) throw new Error('面板没有挂载');
  return host.shadowRoot;
}

/** jsdom 没有实现媒体播放属性，这里用普通属性替代。 */
function fakeVideo(): { element: HTMLVideoElement; rate: () => number; pitch: () => boolean } {
  const element = document.createElement('video');
  let rateValue = 1;
  let pitchValue = true;
  Object.defineProperty(element, 'playbackRate', {
    configurable: true,
    get: () => rateValue,
    set: (value: number) => {
      rateValue = Number(value);
    }
  });
  Object.defineProperty(element, 'preservesPitch', {
    configurable: true,
    get: () => pitchValue,
    set: (value: boolean) => {
      pitchValue = Boolean(value);
    }
  });
  document.body.appendChild(element);
  return { element, rate: () => rateValue, pitch: () => pitchValue };
}

describe('页内倍速面板', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    new Function(MEDIA_CONTROL_SCRIPT)();
  });

  afterEach(() => {
    api().destroy();
    delete (window as unknown as { __bsubMediaAction?: unknown }).__bsubMediaAction;
  });

  it('下发状态会同步到 video 的 playbackRate / preservesPitch', () => {
    const video = fakeVideo();
    api().setState({ rate: 1.5, pitch: false, site: 'bilibili.com', widget: true });
    expect(video.rate()).toBe(1.5);
    expect(video.pitch()).toBe(false);
    expect(api().getState().rate).toBe(1.5);
  });

  it('1× 不干预站点自带的倍速控件', () => {
    const video = fakeVideo();
    video.element.playbackRate = 1.5;
    api().setState({ rate: 1, pitch: true });
    expect(video.rate()).toBe(1.5);
  });

  it('点预设会立即改倍速并把动作回传主进程', () => {
    const video = fakeVideo();
    const send = vi.fn();
    (window as unknown as { __bsubMediaAction: typeof send }).__bsubMediaAction = send;
    api().openPanel();

    const preset = shadow().querySelector('[data-rate="2"]') as HTMLButtonElement;
    preset.click();

    expect(video.rate()).toBe(2);
    expect(api().getState().rate).toBe(2);
    const payload = JSON.parse(send.mock.calls[0][0] as string);
    expect(payload).toMatchObject({ action: 'rate', rate: 2, commit: true });
  });

  it('步进、数值输入和快捷键都能调速', () => {
    const video = fakeVideo();
    api().openPanel();

    (shadow().querySelector('[data-step="0.1"]') as HTMLButtonElement).click();
    expect(video.rate()).toBe(1.1);

    const input = shadow().querySelector('.num') as HTMLInputElement;
    input.value = '3.5';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(video.rate()).toBe(3.5);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true })
    );
    expect(api().getState().rate).toBe(3.6);
  });

  it('单键模式 A / S / D 生效，默认关闭', () => {
    const video = fakeVideo();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(video.rate()).toBe(1);

    api().setState({ rate: 1, singleKey: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(api().getState().rate).toBe(1.1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(api().getState().rate).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(api().getState().rate).toBe(1);
  });

  it('面板打开与收起、Esc 关闭', () => {
    api().openPanel();
    expect(api().getState().panel).toBe(true);
    expect((shadow().querySelector('.panel') as HTMLElement).style.display).toBe('block');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(api().getState().panel).toBe(false);
    expect((shadow().querySelector('.panel') as HTMLElement).style.display).toBe('none');

    api().togglePanel();
    expect(api().getState().panel).toBe(true);
  });
});
