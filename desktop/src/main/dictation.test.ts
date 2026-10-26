import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  registered: [] as string[],
  unregistered: [] as string[],
  clipboard: '',
  notifications: [] as Array<{ title: string; body: string }>
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  Notification: class {
    static isSupported() {
      return true;
    }
    constructor(private options: { title: string; body: string }) {}
    show() {
      state.notifications.push({ title: this.options.title, body: this.options.body });
    }
  },
  clipboard: {
    readText: async () => state.clipboard,
    writeText: async (text: string) => {
      state.clipboard = text;
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
  ipcMain: { on: () => undefined }
}));

vi.mock('./settings', () => ({
  loadSettings: () => ({
    general: { dictation: { enabled: true, accelerator: 'Control+Alt+V', autoPaste: false } }
  })
}));

import { applyDictation, handleDictationResult } from './dictation';
import type { AppSettings } from '../shared/types';

function settings(dictation: AppSettings['general']['dictation']): AppSettings {
  return { general: { dictation } } as unknown as AppSettings;
}

describe('全局听写', () => {
  beforeEach(() => {
    state.registered = [];
    state.unregistered = [];
    state.notifications = [];
    state.clipboard = '旧内容';
  });

  it('启用时注册热键，保存新热键后先注销旧的', () => {
    applyDictation(
      settings({ enabled: true, accelerator: 'Control+Alt+V', autoPaste: true })
    );
    expect(state.registered).toEqual(['Control+Alt+V']);
    applyDictation(
      settings({ enabled: true, accelerator: 'Control+Shift+Space', autoPaste: true })
    );
    expect(state.unregistered).toEqual(['Control+Alt+V']);
    expect(state.registered).toContain('Control+Shift+Space');
  });

  it('关闭时不注册并注销已注册的', () => {
    applyDictation(settings({ enabled: false, accelerator: 'Control+Alt+V', autoPaste: true }));
    expect(state.registered).toEqual([]);
    expect(state.unregistered.length).toBeGreaterThan(0);
  });

  it('识别结果写剪贴板并通知', async () => {
    await handleDictationResult({ text: '这是一段听写' });
    expect(state.clipboard).toBe('这是一段听写');
    expect(state.notifications.at(-1)?.title).toBe('听写完成');
  });

  it('空结果提示失败且不改剪贴板', async () => {
    await handleDictationResult({ text: '', error: '没有识别到语音' });
    expect(state.clipboard).toBe('旧内容');
    expect(state.notifications.at(-1)?.title).toBe('听写失败');
  });
});
