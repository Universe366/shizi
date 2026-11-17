import { dialog, ipcMain } from 'electron';
import type {
  BrowserExtensionsState,
  BrowserExtensionStatus,
  Result
} from '../../shared/types';
import { failure, type IpcContext } from './shared';
import {
  addBrowserExtension,
  addBrowserExtensionFromArchive,
  listBrowserExtensions,
  removeBrowserExtension,
  revealBrowserExtension,
  setBrowserExtensionEnabled,
  setBrowserExtensionsEnabled
} from '../extensions';

/**
 * 浏览器扩展管理。
 *
 * 这里只处理“用户自己装解压目录”的场景；扩展本身跑在 Chromium 的扩展沙箱里，
 * 不经过主进程的 IPC 通道，所以不需要在这里做能力白名单。
 */
export function registerExtensionsIpc(ctx: IpcContext): void {
  ipcMain.handle('extensions:list', (): Result<BrowserExtensionsState> => {
    try {
      return { ok: true, data: listBrowserExtensions() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'extensions:add',
    async (): Promise<Result<BrowserExtensionStatus | null>> => {
      try {
        const picked = await dialog.showOpenDialog(ctx.win, {
          title: '选择解压后的扩展目录',
          buttonLabel: '添加扩展',
          properties: ['openDirectory']
        });
        if (picked.canceled || !picked.filePaths.length) return { ok: true, data: null };
        return await addBrowserExtension(picked.filePaths[0]);
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'extensions:add-archive',
    async (): Promise<Result<BrowserExtensionStatus | null>> => {
      try {
        const picked = await dialog.showOpenDialog(ctx.win, {
          title: '选择扩展包（.zip / .crx）',
          buttonLabel: '安装扩展',
          filters: [{ name: 'Chrome 扩展包', extensions: ['crx', 'zip'] }],
          properties: ['openFile']
        });
        if (picked.canceled || !picked.filePaths.length) return { ok: true, data: null };
        return await addBrowserExtensionFromArchive(picked.filePaths[0]);
      } catch (error) {
        return failure(error);
      }
    }
  );

  // 拖拽目录 / 命令行 / 未来插件市场共用这个入口。
  ipcMain.handle(
    'extensions:add-path',
    async (_event, dir: string): Promise<Result<BrowserExtensionStatus>> => {
      try {
        return await addBrowserExtension(String(dir || ''));
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'extensions:toggle',
    async (_event, id: string, enabled: boolean): Promise<Result<BrowserExtensionStatus>> => {
      try {
        return await setBrowserExtensionEnabled(String(id || ''), enabled === true);
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('extensions:remove', (_event, id: string): Result<boolean> => {
    try {
      return removeBrowserExtension(String(id || ''));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('extensions:reveal', (_event, id: string): Result<boolean> => {
    try {
      return revealBrowserExtension(String(id || ''));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'extensions:set-enabled',
    async (_event, enabled: boolean): Promise<Result<BrowserExtensionsState>> => {
      try {
        return await setBrowserExtensionsEnabled(enabled === true);
      } catch (error) {
        return failure(error);
      }
    }
  );
}
