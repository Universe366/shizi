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

function writeRaw(general: Record<string, unknown>) {
  const base = loadSettings();
  fs.writeFileSync(
    path.join(state.dir, 'settings.json'),
    JSON.stringify({ ...base, general: { ...base.general, ...general } }),
    'utf8'
  );
}

/** 模拟老配置：只保留 restoreSession，没有 startup* 字段。 */
function writeLegacy(general: Record<string, unknown>) {
  const base = loadSettings();
  const legacy = { ...base.general, ...general } as Record<string, unknown>;
  delete legacy.startupMode;
  delete legacy.startupUrl;
  delete legacy.homeUrl;
  fs.writeFileSync(
    path.join(state.dir, 'settings.json'),
    JSON.stringify({ ...base, general: legacy }),
    'utf8'
  );
}

describe('启动与主页设置', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-startup-'));
  });

  it('默认恢复上次会话', () => {
    expect(loadSettings().general.startupMode).toBe('restore');
    expect(loadSettings().general.restoreSession).toBe(true);
  });

  it('老配置只有 restoreSession=false 时按打开起始页处理', () => {
    writeLegacy({ restoreSession: false });
    const settings = loadSettings();
    expect(settings.general.startupMode).toBe('start');
    expect(settings.general.restoreSession).toBe(false);
  });

  it('指定网址启动会关掉会话恢复，并保留 URL', () => {
    writeRaw({ startupMode: 'url', startupUrl: ' https://b.example/x ' });
    const settings = loadSettings();
    expect(settings.general.startupMode).toBe('url');
    expect(settings.general.startupUrl).toBe('https://b.example/x');
    expect(settings.general.restoreSession).toBe(false);
  });

  it('主页网址保存后保留', () => {
    const base = loadSettings();
    saveSettings({ ...base, general: { ...base.general, homeUrl: 'https://home.example' } });
    expect(loadSettings().general.homeUrl).toBe('https://home.example');
  });
});
