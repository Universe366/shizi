import { globalShortcut, type BrowserWindow } from 'electron';
import type { AppSettings } from '../shared/types';

let registered = '';

/** 全局轮盘热键：注册前先注销旧的，避免设置改动后残留。 */
export function applyRadial(settings: AppSettings, getWindow: () => BrowserWindow | null): void {
  if (registered) {
    try {
      globalShortcut.unregister(registered);
    } catch {
      // ignore
    }
    registered = '';
  }
  const radial = settings.general.radial;
  if (!radial?.enabled) return;
  const accelerator = String(radial.hotkey || '').trim();
  if (!accelerator) return;
  try {
    const ok = globalShortcut.register(accelerator, () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send('radial:open');
    });
    if (ok) registered = accelerator;
    else console.warn('[radial] 热键注册失败:', accelerator);
  } catch (error) {
    console.warn('[radial] 热键异常:', (error as Error).message);
  }
}

export function disposeRadial(): void {
  if (!registered) return;
  try {
    globalShortcut.unregister(registered);
  } catch {
    // ignore
  }
  registered = '';
}
