import { BrowserWindow, Notification, clipboard, globalShortcut } from 'electron';
import { spawn } from 'node:child_process';
import type { AppSettings } from '../shared/types';
import { loadSettings } from './settings';

/**
 * 全局语音听写：
 * 热键开始 → 主窗口渲染层录音 → 识别 → 写剪贴板（可选模拟 Ctrl+V 粘贴到前台应用）。
 * 录音本身在渲染层做（麦克风权限已对应用窗口放行），主进程只负责热键与结果处理。
 */

let windowRef: BrowserWindow | null = null;
let registered = '';
let recording = false;
let stopTimer: NodeJS.Timeout | null = null;
let lastClipboard = '';

export function setDictationWindow(win: BrowserWindow | null): void {
  windowRef = win;
}

function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body: body.slice(0, 160) }).show();
  } catch {
    // 通知失败不影响听写
  }
}

function sendRenderer(channel: string): void {
  if (!windowRef || windowRef.isDestroyed()) return;
  try {
    windowRef.webContents.send(channel);
  } catch {
    // ignore
  }
}

function pasteClipboard(): void {
  try {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 150; [System.Windows.Forms.SendKeys]::SendWait('^v')"
      ],
      { windowsHide: true, stdio: 'ignore' }
    );
    child.on('error', () => undefined);
  } catch {
    // 粘贴失败时文字仍在剪贴板里
  }
}

function stopRecording(): void {
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  recording = false;
}

/** 渲染层识别完成（text 为空时带 error）。 */
export async function handleDictationResult(payload: {
  text?: string;
  error?: string;
}): Promise<void> {
  stopRecording();
  const text = String(payload?.text || '').trim();
  if (!text) {
    notify('听写失败', payload?.error || '没有识别到语音');
    return;
  }
  const settings = loadSettings();
  const autoPaste = settings.general.dictation.autoPaste !== false;
  try {
    lastClipboard = await clipboard.readText();
    await clipboard.writeText(text);
  } catch {
    // 剪贴板不可用时仍然尝试粘贴（大概率也失败）
  }
  if (autoPaste) {
    pasteClipboard();
    setTimeout(() => {
      void (async () => {
        try {
          if ((await clipboard.readText()) === text) {
            await clipboard.writeText(lastClipboard || '');
          }
        } catch {
          // ignore
        }
      })();
    }, 1800);
    notify('听写完成', text);
  } else {
    notify('听写完成', '已复制到剪贴板');
  }
}

function toggle(): void {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (!recording) {
    recording = true;
    sendRenderer('dictation:start');
    // 兜底：40 秒还没收到结果就停止，避免一直占着麦克风。
    stopTimer = setTimeout(() => {
      if (!recording) return;
      sendRenderer('dictation:stop');
      recording = false;
    }, 40000);
  } else {
    sendRenderer('dictation:stop');
  }
}

/** 应用/更新听写快捷键（设置保存后立即生效）。 */
export function applyDictation(settings: AppSettings): void {
  if (registered) {
    try {
      globalShortcut.unregister(registered);
    } catch {
      // ignore
    }
    registered = '';
  }
  if (settings.general.dictation?.enabled !== true) return;
  const accelerator = settings.general.dictation.accelerator || 'Control+Alt+V';
  try {
    const ok = globalShortcut.register(accelerator, toggle);
    if (ok) registered = accelerator;
    else notify('听写快捷键注册失败', `${accelerator} 可能已被其它应用占用`);
  } catch (error) {
    notify('听写快捷键注册失败', (error as Error).message);
  }
}

export function initDictation(win: BrowserWindow, settings: AppSettings): void {
  setDictationWindow(win);
  applyDictation(settings);
}

/** 应用退出时注销，避免快捷键残留。 */
export function disposeDictation(): void {
  if (registered) {
    try {
      globalShortcut.unregister(registered);
    } catch {
      // ignore
    }
    registered = '';
  }
  stopRecording();
}
