// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PetSection } from './PetSection';

function general(overrides: Record<string, unknown> = {}) {
  return {
    theme: 'system',
    petEnabled: true,
    petSize: 96,
    petOpacity: 1,
    petSound: true,
    petIdleTalk: true,
    petAlwaysOnTop: true,
    petTheme: 'sakura',
    petMotion: true,
    petSnap: true,
    petClickAction: 'chat',
    petDoubleClickAction: 'main',
    petIdleTalkMinutes: 3,
    petSleepMinutes: 5,
    petSoundVolume: 60,
    petSpeechRate: 1,
    petStartCorner: 'remember',
    petShortcut: true,
    petName: '即时助手',
    ...overrides
  } as never;
}

function installBsub() {
  const api = {
    setPetEnabled: vi.fn(async () => undefined),
    resetPetPosition: vi.fn(async () => undefined)
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

describe('PetSection', () => {
  afterEach(cleanup);

  it('点配色色块会写回主题', () => {
    installBsub();
    const onChange = vi.fn();
    render(<PetSection value={general()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('薄荷绿'));
    expect(onChange).toHaveBeenCalledWith({ petTheme: 'mint' });
  });

  it('单击 / 双击动作可配置', () => {
    installBsub();
    const onChange = vi.fn();
    render(<PetSection value={general()} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue('打开对话气泡'), {
      target: { value: 'screenshot' }
    });
    expect(onChange).toHaveBeenCalledWith({ petClickAction: 'screenshot' });

    fireEvent.change(screen.getByDisplayValue('打开主窗口'), { target: { value: 'none' } });
    expect(onChange).toHaveBeenCalledWith({ petDoubleClickAction: 'none' });
  });

  it('名字最长 12 字，快捷键可关闭', () => {
    installBsub();
    const onChange = vi.fn();
    render(<PetSection value={general()} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue('即时助手'), {
      target: { value: '一个特别特别长的桌宠名字超过十二个字' }
    });
    const patch = onChange.mock.calls[0][0] as { petName: string };
    expect(patch.petName.length).toBeLessThanOrEqual(12);

    fireEvent.click(screen.getByLabelText(/全局截图快捷键/));
    expect(onChange).toHaveBeenCalledWith({ petShortcut: false });
  });

  it('「立即显示」会同时勾上启用', () => {
    const api = installBsub();
    const onChange = vi.fn();
    render(<PetSection value={general({ petEnabled: false })} onChange={onChange} />);
    fireEvent.click(screen.getByText('立即显示'));
    expect(onChange).toHaveBeenCalledWith({ petEnabled: true });
    expect(api.setPetEnabled).toHaveBeenCalledWith(true);
  });
});
