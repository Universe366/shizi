import { ipcMain } from 'electron';
import type { SidebarPage } from '../../shared/types';
import {
  SIDEBAR_PAGE_LIMIT,
  nextSidebarPageId,
  normalizeSidebarPages
} from '../../shared/sidebarPages';
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

  /** 把当前网页一键加到侧栏，省得再打开管理弹窗手填。 */
  ipcMain.handle('sidebar-pages:add', (_event, input: unknown) => {
    try {
      const raw = (input || {}) as { title?: unknown; url?: unknown };
      const normalized = normalizeSidebarPages([
        { id: 'add', title: String(raw.title || ''), url: String(raw.url || '') }
      ])[0];
      if (!normalized) return { ok: false, error: '只支持 http/https 网页' };
      const settings = loadSettings();
      const existing = settings.general.sidebarPages.find(
        (page) => page.url === normalized.url
      );
      if (existing) return { ok: true, data: { page: existing, added: false } };
      if (settings.general.sidebarPages.length >= SIDEBAR_PAGE_LIMIT) {
        return { ok: false, error: `侧栏最多 ${SIDEBAR_PAGE_LIMIT} 个网页` };
      }
      const page = {
        ...normalized,
        id: nextSidebarPageId(settings.general.sidebarPages)
      };
      settings.general.sidebarPages = [...settings.general.sidebarPages, page];
      saveSettings(settings);
      ctx.send('settings:changed', settingsSnapshot());
      return { ok: true, data: { page, added: true } };
    } catch (error) {
      return failure(error);
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

  ipcMain.on('sidebar-web:reload', () => manager.reloadActive());

  ipcMain.handle('sidebar-web:navigate', (_event, url: unknown) => {
    try {
      manager.navigate(String(url || ''));
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.on('sidebar-web:back', () => manager.goBack());
  ipcMain.on('sidebar-web:forward', () => manager.goForward());

  ipcMain.handle('sidebar-web:zoom-in', () => {
    manager.zoomIn();
    return { ok: true, data: manager.getZoom() };
  });
  ipcMain.handle('sidebar-web:zoom-out', () => {
    manager.zoomOut();
    return { ok: true, data: manager.getZoom() };
  });
  ipcMain.handle('sidebar-web:zoom-reset', () => {
    manager.zoomReset();
    return { ok: true, data: manager.getZoom() };
  });
  ipcMain.handle('sidebar-web:state', () => ({ ok: true, data: manager.state() }));

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
