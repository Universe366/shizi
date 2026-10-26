import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir,
    getName: () => 'shizi',
    getVersion: () => '0.0.0'
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => ''
  }
}));

import { loadSettings, platformForTask, saveSettings, stripSecrets } from './settings';

describe('任务槽位 / 用量设置', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-settings-tasks-'));
  });

  afterAll(() => {
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('按任务覆盖模型并持久化', () => {
    const settings = loadSettings();
    settings.ai.taskModels = {
      summary: { platformId: 'deepseek', model: 'deepseek-reasoner' }
    };
    saveSettings(settings);

    const loaded = loadSettings();
    expect(loaded.ai.taskModels.summary).toEqual({
      platformId: 'deepseek',
      model: 'deepseek-reasoner'
    });
    const resolved = platformForTask('summary', loaded);
    expect(resolved.id).toBe('deepseek');
    expect(resolved.model).toBe('deepseek-reasoner');
    // 没配置的任务仍跟随当前平台
    const chat = platformForTask('chat', loaded);
    const active = loaded.ai.platforms.find((item) => item.id === loaded.ai.activeId)!;
    expect(chat.id).toBe(active.id);
    expect(chat.model).toBe(active.model);
  });

  it('只覆盖模型名时沿用当前平台的地址与 Key', () => {
    const settings = loadSettings();
    const active = settings.ai.platforms.find((item) => item.id === settings.ai.activeId)!;
    settings.ai.taskModels = { translate: { platformId: '', model: 'cheap-model' } };
    const resolved = platformForTask('translate', settings);
    expect(resolved.id).toBe(active.id);
    expect(resolved.baseUrl).toBe(active.baseUrl);
    expect(resolved.model).toBe('cheap-model');
  });

  it('指向不存在平台的槽位会被丢弃', () => {
    const settings = loadSettings();
    settings.ai.taskModels = {
      chat: { platformId: 'not-exist', model: 'x' },
      verify: { platformId: 'deepseek', model: 'deepseek-chat' }
    };
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.ai.taskModels.chat).toBeUndefined();
    expect(loaded.ai.taskModels.verify?.model).toBe('deepseek-chat');
  });

  it('多 Key 持久化，导出时清空', () => {
    const settings = loadSettings();
    const platform = settings.ai.platforms.find((item) => item.id === 'deepseek')!;
    platform.apiKey = 'main-key';
    platform.extraKeys = ['k2', 'k3'];
    saveSettings(settings);

    const loaded = loadSettings();
    const saved = loaded.ai.platforms.find((item) => item.id === 'deepseek')!;
    expect(saved.apiKey).toBe('main-key');
    expect(saved.extraKeys).toEqual(['k2', 'k3']);
    expect(stripSecrets(loaded).ai.platforms.find((item) => item.id === 'deepseek')!.extraKeys).toEqual(
      []
    );
  });

  it('用量价格做范围校验', () => {
    const settings = loadSettings();
    settings.usage.prices = {
      'deepseek-chat': { input: 3, output: 12 },
      bad: { input: -5, output: Number.NaN }
    };
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.usage.prices['deepseek-chat']).toEqual({ input: 3, output: 12 });
    expect(loaded.usage.prices.bad).toBeUndefined();
    expect(loaded.usage.enabled).toBe(true);
  });

  it('关闭用量记录会保存', () => {
    const settings = loadSettings();
    settings.usage.enabled = false;
    saveSettings(settings);
    expect(loadSettings().usage.enabled).toBe(false);
    settings.usage.enabled = true;
    saveSettings(settings);
  });

  it('全局听写设置保存', () => {
    const settings = loadSettings();
    settings.general.dictation = {
      enabled: true,
      accelerator: 'Control+Shift+Space',
      autoPaste: false
    };
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.general.dictation).toEqual({
      enabled: true,
      accelerator: 'Control+Shift+Space',
      autoPaste: false
    });
    settings.general.dictation = { enabled: false, accelerator: 'Control+Alt+V', autoPaste: true };
    saveSettings(settings);
  });

  it('快捷取词设置保存', () => {
    const settings = loadSettings();
    settings.general.quickAsk = { enabled: true, accelerator: 'Control+Shift+X' };
    saveSettings(settings);
    expect(loadSettings().general.quickAsk).toEqual({
      enabled: true,
      accelerator: 'Control+Shift+X'
    });
    settings.general.quickAsk = { enabled: false, accelerator: 'Control+Alt+X' };
    saveSettings(settings);
  });

  it('朗读设置与 TTS Key 持久化，导出时清空', () => {
    const settings = loadSettings();
    settings.tts.engine = 'openai';
    settings.tts.rate = 1.5;
    settings.tts.autoRead.chat = true;
    settings.tts.openai.apiKey = 'tts-key';
    saveSettings(settings);

    const loaded = loadSettings();
    expect(loaded.tts.engine).toBe('openai');
    expect(loaded.tts.rate).toBe(1.5);
    expect(loaded.tts.autoRead.chat).toBe(true);
    expect(loaded.tts.openai.apiKey).toBe('tts-key');
    expect(stripSecrets(loaded).tts.openai.apiKey).toBe('');

    settings.tts.engine = 'edge';
    settings.tts.rate = 1;
    settings.tts.autoRead.chat = false;
    settings.tts.openai.apiKey = '';
    saveSettings(settings);
  });
});
