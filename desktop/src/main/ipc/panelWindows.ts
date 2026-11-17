import { ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import type { DetachedPanelInfo } from '../../shared/panelWindows';
import { failure, type IpcContext } from './shared';
import {
  closePanelWindow,
  listPanelWindows,
  openPanelWindow,
  setPanelAlwaysOnTop
} from '../panelWindows';

/** 把侧栏面板拆成独立窗口（含位置/尺寸持久化与置顶）。 */
export function registerPanelWindowIpc(ctx: IpcContext): void {
  ipcMain.handle(
    'panel-window:open',
    (
      _event,
      section: string,
      title?: string,
      options?: { width?: number; height?: number; alwaysOnTop?: boolean }
    ): Result<DetachedPanelInfo> => {
      try {
        return openPanelWindow(String(section || ''), title, options);
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('panel-window:close', (_event, section: string): Result<boolean> => {
    try {
      return closePanelWindow(String(section || ''));
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('panel-window:list', (): Result<DetachedPanelInfo[]> => {
    try {
      return { ok: true, data: listPanelWindows() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'panel-window:always-on-top',
    (_event, section: string, alwaysOnTop: boolean): Result<boolean> => {
      try {
        return setPanelAlwaysOnTop(String(section || ''), alwaysOnTop === true);
      } catch (error) {
        return failure(error);
      }
    }
  );

  // 独立窗口里的「总结/章节/设置」入口：聚焦主窗口并切到对应面板。
  ipcMain.handle('app:open-section', (_event, section: string): Result<boolean> => {
    try {
      const win = ctx.win;
      if (!win || win.isDestroyed()) throw new Error('主窗口不可用');
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('ui:open-section', String(section || ''));
      return { ok: true, data: true };
    } catch (error) {
      return failure(error);
    }
  });
}
