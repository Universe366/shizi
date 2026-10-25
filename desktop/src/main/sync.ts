import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '../shared/types';
import { saveSettings, settingsForExport } from './settings';

/**
 * 云同步（文件夹版）：把设置写到用户指定的同步文件夹，
 * 由 OneDrive / 坚果云 / Nextcloud 等客户端负责上传；不保存任何账号密码。
 * 导出内容不含 API Key / 桥 Token（与「导出设置」一致）。
 */

export const SYNC_FILE = 'shizi-settings.json';

export function syncFilePath(folder: string): string {
  const dir = String(folder || '').trim();
  if (!dir) throw new Error('还没有选择同步文件夹');
  return path.join(dir, SYNC_FILE);
}

export function pushSettingsTo(folder: string): { path: string } {
  const file = syncFilePath(folder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    app: 'shizi',
    kind: 'settings',
    exportedAt: new Date().toISOString(),
    settings: settingsForExport()
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return { path: file };
}

export function readSettingsFrom(folder: string): AppSettings {
  const file = syncFilePath(folder);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    app?: string;
    settings?: unknown;
  };
  if (!raw || typeof raw !== 'object') throw new Error('同步文件格式不正确');
  const candidate = (raw.settings ?? raw) as Record<string, unknown>;
  if (!candidate || typeof candidate !== 'object' || !candidate.general) {
    throw new Error('同步文件里没有设置数据');
  }
  return saveSettings(candidate as unknown as AppSettings);
}

export function pullSettingsFrom(folder: string): { settings: AppSettings; path: string } {
  const settings = readSettingsFrom(folder);
  return { settings, path: syncFilePath(folder) };
}

export function syncStatus(folder: string): { exists: boolean; modifiedAt?: number; path: string } {
  const file = syncFilePath(folder);
  try {
    const stat = fs.statSync(file);
    return { exists: true, modifiedAt: stat.mtimeMs, path: file };
  } catch {
    return { exists: false, path: file };
  }
}
