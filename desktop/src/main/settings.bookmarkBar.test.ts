import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir,
    getName: () => 'shizi',
    getVersion: () => '0.0.0'
  }
}));

import { loadSettings, saveSettings } from './settings';

describe('书签栏设置', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-bookmarkbar-'));
  });

  it('默认显示，显式关闭后保留', () => {
    const defaults = loadSettings();
    expect(defaults.general.bookmarkBar).toBe(true);

    saveSettings({ ...defaults, general: { ...defaults.general, bookmarkBar: false } });
    expect(loadSettings().general.bookmarkBar).toBe(false);

    saveSettings({ ...defaults, general: { ...defaults.general, bookmarkBar: true } });
    expect(loadSettings().general.bookmarkBar).toBe(true);
  });

  it('老配置没有该字段时按显示处理', () => {
    const defaults = loadSettings();
    const raw = { ...defaults, general: { ...defaults.general } } as Record<string, unknown>;
    delete (raw.general as Record<string, unknown>).bookmarkBar;
    fs.writeFileSync(
      path.join(state.dir, 'settings.json'),
      JSON.stringify(raw),
      'utf8'
    );
    expect(loadSettings().general.bookmarkBar).toBe(true);
  });
});
