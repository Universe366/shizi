import { ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import { failure, type IpcContext } from './shared';
import { loadSettings, saveSettings } from '../settings';

/** 主窗口级别的小能力：置顶、最小化、最大化。 */
export function registerWindowIpc(ctx: IpcContext): void {
  ipcMain.handle('window:minimize', (): Result<boolean> => {
    try {
      const win = ctx.win;
      if (!win || win.isDestroyed()) throw new Error('主窗口不可用');
      win.minimize();
      return { ok: true, data: true };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('window:toggle-maximize', (): Result<boolean> => {
    try {
      const win = ctx.win;
      if (!win || win.isDestroyed()) throw new Error('主窗口不可用');
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { ok: true, data: win.isMaximized() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('window:is-maximized', (): Result<boolean> => {
    try {
      const win = ctx.win;
      if (!win || win.isDestroyed()) throw new Error('主窗口不可用');
      return { ok: true, data: win.isMaximized() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('window:always-on-top', (): Result<boolean> => {
    try {
      const win = ctx.win;
      if (!win || win.isDestroyed()) throw new Error('主窗口不可用');
      return { ok: true, data: win.isAlwaysOnTop() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'window:set-always-on-top',
    (_event, enabled: boolean): Result<boolean> => {
      try {
        const win = ctx.win;
        if (!win || win.isDestroyed()) throw new Error('主窗口不可用');
        const next = enabled === true;
        win.setAlwaysOnTop(next);
        const settings = loadSettings();
        saveSettings({ ...settings, general: { ...settings.general, alwaysOnTop: next } });
        // 返回窗口的真实状态，而不是入参，避免平台差异导致 UI 与实际不一致。
        return { ok: true, data: win.isAlwaysOnTop() };
      } catch (error) {
        return failure(error);
      }
    }
  );
}
