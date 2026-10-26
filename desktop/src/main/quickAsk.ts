import { Notification, clipboard, globalShortcut } from 'electron';
import { spawn } from 'node:child_process';
import type { AppSettings } from '../shared/types';
import { openPetWindow, petWebContents } from './petWindow';

/**
 * 全局快捷取词：在任意应用里选中文字后按热键，
 * 向当前前台应用发一次 Ctrl+C，把选中内容交给桌宠。
 * 不依赖辅助功能权限，属于兼容性优先的实现。
 */

let registered = '';

function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body: body.slice(0, 160) }).show();
  } catch {
    // ignore
  }
}

function copyFromForeground(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 120; [System.Windows.Forms.SendKeys]::SendWait('^c'); Start-Sleep -Milliseconds 220"
        ],
        { windowsHide: true, stdio: 'ignore' }
      );
      child.on('close', () => resolve());
      child.on('error', () => resolve());
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolve();
      }, 4000);
    } catch {
      resolve();
    }
  });
}

async function trigger(): Promise<void> {
  let before = '';
  try {
    before = await clipboard.readText();
  } catch {
    // ignore
  }
  await copyFromForeground();
  let text = '';
  try {
    const after = await clipboard.readText();
    if (after && after !== before) {
      text = after.trim().slice(0, 4000);
      // 恢复用户原来的剪贴板，避免取词污染。
      await clipboard.writeText(before || '');
    }
  } catch {
    // ignore
  }

  if (!text) {
    notify('没有取到选中文字', '该应用可能不支持复制，可以改用截图取字');
  }
  openPetWindow();
  setTimeout(() => {
    const contents = petWebContents();
    if (!contents || contents.isDestroyed()) return;
    try {
      contents.send('pet:selection', {
        text,
        error: text ? '' : '没有取到选中文字，可以改用截图取字'
      });
    } catch {
      // ignore
    }
  }, 180);
}

/** 设置保存后立即生效。 */
export function applyQuickAsk(settings: AppSettings): void {
  if (registered) {
    try {
      globalShortcut.unregister(registered);
    } catch {
      // ignore
    }
    registered = '';
  }
  const quickAsk = settings.general.quickAsk;
  if (quickAsk?.enabled !== true) return;
  const accelerator = quickAsk.accelerator || 'Control+Alt+X';
  try {
    const ok = globalShortcut.register(accelerator, () => void trigger());
    if (ok) registered = accelerator;
    else notify('快捷取词快捷键注册失败', `${accelerator} 可能已被其它应用占用`);
  } catch (error) {
    notify('快捷取词快捷键注册失败', (error as Error).message);
  }
}

export function disposeQuickAsk(): void {
  if (!registered) return;
  try {
    globalShortcut.unregister(registered);
  } catch {
    // ignore
  }
  registered = '';
}
