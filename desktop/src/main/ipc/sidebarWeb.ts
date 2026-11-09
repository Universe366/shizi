import { ipcMain } from 'electron';
import type { SidebarPage } from '../../shared/types';
import { normalizeSidebarPages } from '../../shared/sidebarPages';
import { loadSettings, saveSettings, settingsSnapshot } from '../settings';
import type { SidebarWebManager } from '../sidebarWeb';
import { failure } from './shared';
import type { IpcContext } from './shared';

/** 侧栏网页：列表持久化 + 视图生命周期。 */
export function registerSidebarWebIpc(ctx: IpcContext, manager: SidebarWebManager): void {
  ipcMain.handle('sidebar-pages:save', (_event, input: unknown) => {
    try {
      const settings = loadSettings();
      settings.general.sidebarPages = normalizeSidebarPages(input);
      saveSettings(settings);
      ctx.send('settings:changed', settingsSnapshot());
      return { ok: true, data: settings.general.sidebarPages };
    } catch (error) {
      return failure<SidebarPage[]>(error);
    }
  });

  ipcMain.handle('sidebar-web:activate', (_event, input: unknown) => {
    try {
      const page = normalizeSidebarPages([input])[0];
      if (!page) return { ok: false, error: '网址无效（只支持 http/https）' };
      manager.activate(page);
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.on('sidebar-web:deactivate', () => manager.deactivate());

  ipcMain.on('sidebar-web:bounds', (_event, rect: { x?: number; y?: number; width?: number; height?: number }) => {
    manager.setBounds({
      x: Number(rect?.x) || 0,
      y: Number(rect?.y) || 0,
      width: Number(rect?.width) || 0,
      height: Number(rect?.height) || 0
    });
  });

  ipcMain.on('sidebar-web:visible', (_event, visible: unknown) => {
    manager.setVisible(visible === true);
  });

  ipcMain.handle('sidebar-web:clear', async () => {
    try {
      await manager.clearData();
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });
}
