import { dialog, ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import type { PluginInfo, PluginListState } from '../../shared/plugins';
import { failure, type IpcContext } from './shared';
import type { PluginMarketResult } from '../../shared/plugins';
import {
  fetchPluginMarket,
  installPluginFromArchive,
  installPluginFromDir,
  installPluginFromUrl,
  listPlugins,
  pluginMarketUrl,
  pluginRpc,
  removePlugin,
  revealPlugin,
  setPluginEnabled,
  setPluginMarketUrl
} from '../plugins';

/** 应用插件管理 + 插件 UI 的能力调用入口。 */
export function registerPluginsIpc(ctx: IpcContext): void {
  ipcMain.handle('plugins:list', (): Result<PluginListState> => {
    try {
      return { ok: true, data: { plugins: listPlugins() } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('plugins:install', async (): Promise<Result<PluginInfo | null>> => {
    try {
      const picked = await dialog.showOpenDialog(ctx.win, {
        title: '选择插件目录（包含 manifest.json）',
        buttonLabel: '安装插件',
        properties: ['openDirectory']
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: true, data: null };
      const result = installPluginFromDir(picked.filePaths[0]);
      if (result.ok) ctx.send('plugins:changed');
      return result;
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('plugins:install-archive', async (): Promise<Result<PluginInfo | null>> => {
    try {
      const picked = await dialog.showOpenDialog(ctx.win, {
        title: '选择插件包（.zip）',
        buttonLabel: '安装插件',
        filters: [{ name: '插件包', extensions: ['zip'] }],
        properties: ['openFile']
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: true, data: null };
      const result = installPluginFromArchive(picked.filePaths[0]);
      if (result.ok) ctx.send('plugins:changed');
      return result;
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('plugins:market-url', (): Result<string> => {
    try {
      return { ok: true, data: pluginMarketUrl() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('plugins:set-market-url', (_event, url: string): Result<string> => {
    try {
      return setPluginMarketUrl(String(url || ''));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'plugins:market',
    async (_event, url?: string): Promise<Result<PluginMarketResult>> => {
      try {
        return await fetchPluginMarket(url);
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'plugins:install-url',
    async (_event, url: string): Promise<Result<PluginInfo>> => {
      try {
        const result = await installPluginFromUrl(String(url || ''));
        if (result.ok) ctx.send('plugins:changed');
        return result;
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'plugins:install-path',
    (_event, dir: string): Result<PluginInfo> => {
      try {
        const result = installPluginFromDir(String(dir || ''));
        if (result.ok) ctx.send('plugins:changed');
        return result;
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'plugins:toggle',
    (_event, id: string, enabled: boolean): Result<PluginInfo> => {
      try {
        const result = setPluginEnabled(String(id || ''), enabled === true);
        if (result.ok) ctx.send('plugins:changed');
        return result;
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('plugins:remove', (_event, id: string): Result<boolean> => {
    try {
      const result = removePlugin(String(id || ''));
      if (result.ok) ctx.send('plugins:changed');
      return result;
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('plugins:reveal', (_event, id: string): Result<boolean> => {
    try {
      return revealPlugin(String(id || ''));
    } catch (error) {
      return failure(error);
    }
  });

  // 插件 iframe 的所有能力调用都从这里过；权限在 pluginRpc 里按 manifest 校验。
  ipcMain.handle(
    'plugins:rpc',
    async (_event, pluginId: string, method: string, params: unknown): Promise<Result<unknown>> => {
      try {
        return await pluginRpc(String(pluginId || ''), String(method || ''), params, ctx.tabs);
      } catch (error) {
        return failure(error);
      }
    }
  );
}
