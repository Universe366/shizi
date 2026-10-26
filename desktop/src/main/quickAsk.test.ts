import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../shared/types';

const state = vi.hoisted(() => ({
  registered: [] as string[],
  unregistered: [] as string[]
}));

vi.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return true;
    }
    show() {
      // ignore
    }
  },
  globalShortcut: {
    register: (accelerator: string) => {
      state.registered.push(accelerator);
      return true;
    },
    unregister: (accelerator: string) => {
      state.unregistered.push(accelerator);
    }
  },
  clipboard: { readText: async () => '', writeText: async () => undefined }
}));

vi.mock('./petWindow', () => ({
  openPetWindow: () => undefined,
  petWebContents: () => null
}));

import { applyQuickAsk, disposeQuickAsk } from './quickAsk';

function settings(quickAsk: AppSettings['general']['quickAsk']): AppSettings {
  return { general: { quickAsk } } as unknown as AppSettings;
}

describe('全局快捷取词', () => {
  beforeEach(() => {
    disposeQuickAsk();
    state.registered = [];
    state.unregistered = [];
  });

  it('启用时注册热键', () => {
    applyQuickAsk(settings({ enabled: true, accelerator: 'Control+Alt+X' }));
    expect(state.registered).toEqual(['Control+Alt+X']);
  });

  it('改热键时先注销旧的', () => {
    applyQuickAsk(settings({ enabled: true, accelerator: 'Control+Alt+X' }));
    applyQuickAsk(settings({ enabled: true, accelerator: 'Control+Shift+X' }));
    expect(state.unregistered).toEqual(['Control+Alt+X']);
    expect(state.registered).toContain('Control+Shift+X');
  });

  it('关闭后注销已注册的热键', () => {
    applyQuickAsk(settings({ enabled: true, accelerator: 'Control+Alt+X' }));
    state.unregistered = [];
    applyQuickAsk(settings({ enabled: false, accelerator: 'Control+Alt+X' }));
    expect(state.unregistered).toEqual(['Control+Alt+X']);
    applyQuickAsk(settings({ enabled: false, accelerator: 'Control+Alt+X' }));
    expect(state.registered).toEqual(['Control+Alt+X']);
  });
});
