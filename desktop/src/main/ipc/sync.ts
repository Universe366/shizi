import { dialog, ipcMain } from 'electron';
import type { IpcContext } from './shared';
import { failure } from './shared';
import { settingsSnapshot } from '../settings';
import { pullSettingsFrom, pushSettingsTo, syncStatus } from '../sync';

/** 云同步（文件夹版）：选择目录、上传、下载、状态。 */
export function registerSyncIpc(ctx: IpcContext): void {
  ipcMain.handle('sync:choose', async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: '选择同步文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { ok: true, data: null };
    return { ok: true, data: result.filePaths[0] };
  });

  ipcMain.handle('sync:status', (_event, folder: unknown) => {
    try {
      return { ok: true, data: syncStatus(String(folder || '')) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('sync:push', (_event, folder: unknown) => {
    try {
      return { ok: true, data: pushSettingsTo(String(folder || '')) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('sync:pull', (_event, folder: unknown) => {
    try {
      const result = pullSettingsFrom(String(folder || ''));
      ctx.send('settings:changed', settingsSnapshot());
      return { ok: true, data: result };
    } catch (error) {
      return failure(error);
    }
  });
}
