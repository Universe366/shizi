import { app } from 'electron';

/** 开机自启动：Windows/macOS 走系统登录项；其它平台忽略。 */
export function applyAutoStart(enabled: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--autostart'] });
  } catch (error) {
    console.warn('[autoStart] 设置失败:', (error as Error).message);
  }
}

export function autoStartEnabled(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin === true;
  } catch {
    return false;
  }
}
