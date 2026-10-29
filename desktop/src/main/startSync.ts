import fs from 'node:fs';
import path from 'node:path';

/**
 * 起始页数据同步（文件夹版）：写到用户设置的同步文件夹，
 * 由 OneDrive / 坚果云 / Nextcloud 等客户端负责上传；不保存账号密码。
 */

export const START_SYNC_FILE = 'shizi-start.json';

function syncFile(folder: string): string {
  const dir = String(folder || '').trim();
  if (!dir) throw new Error('还没有选择同步文件夹');
  return path.join(dir, START_SYNC_FILE);
}

export function pushStartData(folder: string, payload: unknown): { path: string } {
  if (!payload || typeof payload !== 'object' || (payload as { app?: string }).app !== 'shizi-start') {
    throw new Error('不是拾字起始页的数据');
  }
  const file = syncFile(folder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return { path: file };
}

export function pullStartData(folder: string): { data: unknown; path: string } {
  const file = syncFile(folder);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || (raw as { app?: string }).app !== 'shizi-start') {
    throw new Error('同步文件不是拾字起始页数据');
  }
  return { data: raw, path: file };
}

export function startSyncStatus(folder: string): {
  exists: boolean;
  path: string;
  modifiedAt?: number;
} {
  const file = syncFile(folder);
  try {
    const stat = fs.statSync(file);
    return { exists: true, path: file, modifiedAt: stat.mtimeMs };
  } catch {
    return { exists: false, path: file };
  }
}
