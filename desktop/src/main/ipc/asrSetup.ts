import { ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import type { IpcContext } from './shared';
import { failure } from './shared';
import {
  downloadLocalModel,
  downloadWhisperBinary,
  localAsrStatus,
  type DownloadProgress,
  type LocalModelId
} from '../localAsrSetup';

const controllers = new Map<string, AbortController>();

function progressSender(ctx: IpcContext, key: string) {
  return (progress: DownloadProgress) => {
    ctx.send('asr:download-progress', { ...progress, key });
  };
}

/** 本地 whisper.cpp 的“下载/状态”通道；下载过程用事件回报进度。 */
export function registerAsrSetupIpc(ctx: IpcContext): void {
  ipcMain.handle('asr:local-status', (): Result<ReturnType<typeof localAsrStatus>> => {
    try {
      return { ok: true, data: localAsrStatus() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'asr:download-model',
    async (_event, id: LocalModelId): Promise<Result<{ path: string }>> => {
      const key = `model:${id}`;
      if (controllers.has(key)) return { ok: false, error: '模型正在下载中' };
      const controller = new AbortController();
      controllers.set(key, controller);
      try {
        const path = await downloadLocalModel(id, progressSender(ctx, key), controller.signal);
        return { ok: true, data: { path } };
      } catch (error) {
        return failure(error);
      } finally {
        controllers.delete(key);
      }
    }
  );

  ipcMain.handle(
    'asr:download-binary',
    async (): Promise<Result<{ path: string }>> => {
      const key = 'binary';
      if (controllers.has(key)) return { ok: false, error: 'whisper.cpp 正在下载中' };
      const controller = new AbortController();
      controllers.set(key, controller);
      try {
        const path = await downloadWhisperBinary(progressSender(ctx, key), controller.signal);
        return { ok: true, data: { path } };
      } catch (error) {
        return failure(error);
      } finally {
        controllers.delete(key);
      }
    }
  );

  ipcMain.on('asr:cancel-download', (_event, key: string) => {
    controllers.get(String(key))?.abort();
  });
}
