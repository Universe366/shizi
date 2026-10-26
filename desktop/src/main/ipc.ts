import { BrowserWindow } from 'electron';

import type { TabManager } from './tabs';

import { registerBrowserIpc } from './ipc/browser';
import { registerRecordsIpc } from './ipc/records';
import { registerSettingsIpc } from './ipc/settings';
import { registerToolsIpc } from './ipc/tools';
import { registerPageIpc } from './ipc/page';
import { registerJobsIpc } from './ipc/jobs';
import { registerLibraryIpc } from './ipc/library';
import { registerMediaIpc } from './ipc/media';
import { registerShotIpc } from './ipc/shot';
import { registerStartIpc } from './ipc/start';
import { registerSyncIpc } from './ipc/sync';
import { registerPetToolsIpc } from './ipc/petTools';
import { registerAsrSetupIpc } from './ipc/asrSetup';
import { registerVideoIpc } from './ipc/video';
import { registerUsageIpc } from './ipc/usage';
import { registerOcrIpc } from './ipc/ocr';
import { registerTtsIpc } from './ipc/tts';
import { registerChatHistoryIpc } from './ipc/chatHistory';
import { abortControllers } from './ipc/shared';
import type { IpcContext } from './ipc/shared';

const { ai: aiControllers } = abortControllers;

export function registerIpc(win: BrowserWindow, tabs: TabManager): void {
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
    // 桌宠是独立窗口：设置变化（大小/主题/名字/不透明度…）也要实时同步过去。
    if (channel === 'settings:changed') {
      for (const other of BrowserWindow.getAllWindows()) {
        if (other === win || other.isDestroyed()) continue;
        try {
          other.webContents.send(channel, payload);
        } catch {
          // ignore
        }
      }
    }
  };
  const ctx: IpcContext = { win, send, tabs, aiControllers };
  registerJobsIpc(ctx);

  registerBrowserIpc(ctx);

  registerPageIpc(ctx);

  registerLibraryIpc(ctx);

  registerSettingsIpc(ctx);

  registerMediaIpc(ctx);

  registerAsrSetupIpc(ctx);

  registerVideoIpc(ctx);

  registerShotIpc();

  registerUsageIpc();

  registerOcrIpc();

  registerTtsIpc();

  registerChatHistoryIpc();

  registerStartIpc();

  registerSyncIpc(ctx);

  registerPetToolsIpc();

  registerToolsIpc(ctx);

  registerRecordsIpc(ctx);

  // 渲染进程加载完成后补发一次当前标签状态
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('tabs:changed', tabs.list());
  });
}
