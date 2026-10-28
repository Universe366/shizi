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
  }
}));

import { loadSettings, saveSettings, setTabsLayout } from './settings';

describe('设置的持久化字段', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-settings-'));
  });

  afterAll(() => {
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('桌宠 / 悬浮球 / 搜索引擎保存后不会丢', () => {
    const settings = loadSettings();
    settings.general.petEnabled = true;
    settings.general.assistantEnabled = true;
    settings.general.petX = 120;
    settings.general.petY = 80;
    settings.general.petSize = 140;
    settings.general.petOpacity = 0.7;
    settings.general.petSound = false;
    settings.general.petIdleTalk = false;
    settings.general.petAlwaysOnTop = false;
    settings.general.searchEngine = 'bing';
    settings.general.searchEngineCustom = 'https://s.example/?q={q}';
    saveSettings(settings);

    const reloaded = loadSettings();
    expect(reloaded.general.petEnabled).toBe(true);
    expect(reloaded.general.assistantEnabled).toBe(true);
    expect(reloaded.general.petX).toBe(120);
    expect(reloaded.general.petY).toBe(80);
    expect(reloaded.general.petSize).toBe(140);
    expect(reloaded.general.petOpacity).toBe(0.7);
    expect(reloaded.general.petSound).toBe(false);
    expect(reloaded.general.petIdleTalk).toBe(false);
    expect(reloaded.general.petAlwaysOnTop).toBe(false);
    expect(reloaded.general.searchEngine).toBe('bing');
    expect(reloaded.general.searchEngineCustom).toBe('https://s.example/?q={q}');
  });

  it('对话快捷指令有默认值并可持久化', () => {
    const settings = loadSettings();
    expect(settings.ai.chatPrompts.length).toBeGreaterThan(0);
    const original = settings.ai.chatPrompts;
    settings.ai.chatPrompts = [{ id: 'test', name: '测试指令', text: '你好' }];
    saveSettings(settings);
    expect(loadSettings().ai.chatPrompts).toEqual([
      { id: 'test', name: '测试指令', text: '你好' }
    ]);
    settings.ai.chatPrompts = original;
    saveSettings(settings);
  });

  it('非法搜索引擎回退必应，坐标非法归零', () => {
    const settings = loadSettings();
    settings.general.searchEngine = 'nonsense' as unknown as 'bilibili';
    settings.general.petX = Number.NaN;
    settings.general.petY = -1;
    saveSettings(settings);
    const reloaded = loadSettings();
    expect(reloaded.general.searchEngine).toBe('bing');
    expect(reloaded.general.petX).toBe(0);
    expect(reloaded.general.petY).toBe(-1);
  });

  it('垂直标签栏宽度夹在 160–360，折叠状态可单独持久化', () => {
    setTabsLayout({ width: 999, collapsed: true });
    let reloaded = loadSettings();
    expect(reloaded.general.verticalTabsWidth).toBe(360);
    expect(reloaded.general.verticalTabsCollapsed).toBe(true);

    setTabsLayout({ width: 100 });
    reloaded = loadSettings();
    expect(reloaded.general.verticalTabsWidth).toBe(160);
    expect(reloaded.general.verticalTabsCollapsed).toBe(true);
    expect(reloaded.general.verticalTabs).toBe(true);
  });

  it('本地 Whisper 平台的路径、类型和线程数保存后不丢', () => {
    const settings = loadSettings();
    settings.asr.platforms = [
      {
        id: 'local-whisper',
        name: '本地 Whisper',
        kind: 'local-whisper',
        baseUrl: '',
        apiKey: '',
        model: '',
        models: [],
        localExe: 'D:\\whisper\\whisper-cli.exe',
        localModel: 'D:\\whisper\\ggml-base.bin'
      }
    ];
    settings.asr.activeId = 'local-whisper';
    settings.asr.localThreads = 12;
    saveSettings(settings);

    const platform = loadSettings().asr.platforms[0];
    expect(platform.kind).toBe('local-whisper');
    expect(platform.localExe).toBe('D:\\whisper\\whisper-cli.exe');
    expect(platform.localModel).toBe('D:\\whisper\\ggml-base.bin');
    expect(loadSettings().asr.localThreads).toBe(12);
  });
});
