import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./settings', () => ({
  settingsForExport: vi.fn(() => ({ general: { petName: '本机' }, ai: {} })),
  saveSettings: vi.fn((next: unknown) => next)
}));

import { pullSettingsFrom, pushSettingsTo, readSettingsFrom, syncFilePath, syncStatus } from './sync';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-sync-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('云同步（文件夹）', () => {
  it('上传后文件存在，内容带 app/kind', () => {
    const result = pushSettingsTo(dir);
    expect(result.path).toBe(path.join(dir, 'shizi-settings.json'));
    const raw = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(raw.app).toBe('shizi');
    expect(raw.kind).toBe('settings');
    expect(raw.settings.general.petName).toBe('本机');
    expect(syncStatus(dir).exists).toBe(true);
  });

  it('可以读回设置', () => {
    pushSettingsTo(dir);
    const settings = readSettingsFrom(dir);
    expect(settings.general.petName).toBe('本机');
    expect(pullSettingsFrom(dir).settings).toEqual(settings);
  });

  it('没有文件夹时报错', () => {
    expect(() => syncFilePath('   ')).toThrow('同步文件夹');
  });

  it('文件格式不对时报错', () => {
    fs.writeFileSync(path.join(dir, 'shizi-settings.json'), '{"nope":1}', 'utf8');
    expect(() => readSettingsFrom(dir)).toThrow('没有设置数据');
  });

  it('状态在文件缺失时返回 exists=false', () => {
    expect(syncStatus(dir)).toEqual({
      exists: false,
      path: path.join(dir, 'shizi-settings.json')
    });
  });
});
