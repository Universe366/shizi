import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dialog, ipcMain, shell } from 'electron';
import type { ConvertTargetResult } from '../../shared/types';
import { convertFile } from '../convert';

const controllers = new Map<string, AbortController>();

export function registerConvertIpc(): void {
  ipcMain.handle('convert:pick', async (): Promise<{ ok: true; data: string[] } | { ok: false; error: string }> => {
    try {
      const direct = String(process.env.BSUB_CONVERT_FILES || '')
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean);
      if (direct.length) return { ok: true, data: direct };
      const result = await dialog.showOpenDialog({
        title: '选择要转换的文件',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '媒体文件',
            extensions: [
              'mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'm4v', 'ts',
              'mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus',
              'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'gif'
            ]
          },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (result.canceled) return { ok: true, data: [] };
      return { ok: true, data: result.filePaths };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(
    'convert:run',
    async (
      event,
      payload: { paths: string[]; target: string }
    ): Promise<{ ok: true; data: { requestId: string } } | { ok: false; error: string }> => {
      try {
        const paths = (payload?.paths || []).filter(
          (file) => typeof file === 'string' && fs.existsSync(file)
        );
        if (!paths.length) return { ok: false, error: '请先选择文件' };
        const target = String(payload?.target || '');
        if (!target) return { ok: false, error: '请选择目标格式' };
        const requestId = randomUUID();
        const controller = new AbortController();
        controllers.set(requestId, controller);
        const results: ConvertTargetResult[] = [];
        void (async () => {
          try {
            for (let index = 0; index < paths.length; index += 1) {
              const file = paths[index];
              const name = file.split(/[\\/]/).pop() || file;
              if (!event.sender.isDestroyed()) {
                event.sender.send('convert:progress', {
                  requestId,
                  file: name,
                  index,
                  total: paths.length,
                  percent: 0,
                  message: `准备转换 ${name}`
                });
              }
              const result = await convertFile(
                file,
                target,
                (percent, message) => {
                  if (!event.sender.isDestroyed()) {
                    event.sender.send('convert:progress', {
                      requestId,
                      file: name,
                      index,
                      total: paths.length,
                      percent,
                      message
                    });
                  }
                },
                controller.signal
              );
              results.push({ source: file, output: result.path });
            }
            if (!event.sender.isDestroyed()) event.sender.send('convert:done', { requestId, files: results });
          } catch (error) {
            if (!event.sender.isDestroyed()) {
              event.sender.send('convert:error', {
                requestId,
                error: controller.signal.aborted
                  ? '已取消'
                  : (error as Error)?.message || String(error)
              });
            }
          } finally {
            controllers.delete(requestId);
          }
        })();
        return { ok: true, data: { requestId } };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('convert:cancel', (_event, requestId: string) => {
    controllers.get(String(requestId))?.abort();
  });

  ipcMain.handle('convert:reveal', async (_event, file: string) => {
    try {
      shell.showItemInFolder(String(file));
    } catch {
      // ignore
    }
  });
}
