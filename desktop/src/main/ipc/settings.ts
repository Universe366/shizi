import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { applyAutoStart } from '../autoStart';
import { applyProxy } from '../proxy';
import { applyDictation } from '../dictation';
import { applyQuickAsk } from '../quickAsk';
import { resetMcpSession } from '../mcp';
import { applyRadial } from '../radial';
import { registerPetShortcuts } from '../petShortcuts';

type CloseDecisionPayload = { choice?: string; remember?: boolean };
let closeDecisionHandler: ((payload: CloseDecisionPayload) => void) | null = null;
let closeShownHandler: (() => void) | null = null;

export function setCloseDecisionHandler(
  handler: ((payload: CloseDecisionPayload) => void) | null
): void {
  closeDecisionHandler = handler;
}

/** 渲染层关闭框真正显示出来时的回调：用来取消「弹窗没出来」的兜底计时。 */
export function setCloseShownHandler(handler: (() => void) | null): void {
  closeShownHandler = handler;
}
import type {
  AiPlatform,
  AsrPlatform,
  AppSettings,
  BridgeStatus,
  Result,
  SearchPlatform,
  UpdateStatus
} from '../../shared/types';
import {
  loadSettings,
  saveSettings,
  setSidebarLayout,
  setSidebarWidth,
  setTabsLayout,
  settingsForExport,
  settingsSnapshot
} from '../settings';
import { bridgeStatus, restartBridge } from '../bridge';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  skipUpdate,
  updateStatus
} from '../updater';
import { clearSitePermissions, permissionSummary, revokeSitePermission } from '../permissions';
import { exportDiagnostics } from '../diagnostics';
import { backupData, restoreData } from '../backup';
import { changeDataDir } from '../dataDir';
import { installBrowserExtension } from '../extension-install';
import { probePlatformModels, testPlatformConnection } from '../platform';

import { listLibrary } from '../library';
import { fetchWebPage } from '../web/fetch';
import { failure, type IpcContext } from './shared';
import {
  applyPetSettings,
  beginPetDrag,
  dropPet,
  endPetDrag,
  movePet,
  petBodyRect,
  petBlur,
  petFlipped,
  petPosition,
  resetPetPosition,
  resizeBubble,
  setPetAlwaysOnTop,
  setPetEnabled,
  setPetLayout
} from '../petWindow';
import type { PetLayoutMode } from '../petGeometry';
import { petShortcutStatus, petShortcutsStatus } from '../petShortcuts';

/** 设置 / 更新 / 桥 / 权限 / 数据目录 / 诊断 相关 IPC。 */
export function registerSettingsIpc(ctx: IpcContext): void {
  ipcMain.on('app:close-decision', (_event, payload: CloseDecisionPayload) => {
    closeDecisionHandler?.(payload);
  });
  ipcMain.on('app:close-shown', () => {
    closeShownHandler?.();
  });

  ipcMain.handle('pet:get-position', () => petPosition());
  ipcMain.handle('pet:reset-position', () => resetPetPosition());
  ipcMain.handle('pet:move', (_event, x: number, y: number) => {
    movePet(Number(x), Number(y));
  });
  ipcMain.handle('pet:drop', (_event, x: number, y: number) => dropPet(Number(x), Number(y)));
  ipcMain.handle('pet:set-layout', (_event, mode: PetLayoutMode) => {
    setPetLayout(mode);
  });
  ipcMain.handle('pet:set-always-on-top', (_event, enabled: boolean) =>
    setPetAlwaysOnTop(enabled === true)
  );
  ipcMain.handle('app:focus-main', () => {
    ctx.win.show();
    ctx.win.focus();
  });
  ipcMain.handle('pet:blur', () => petBlur());
  ipcMain.handle('pet:begin-drag', () => {
    beginPetDrag();
  });
  ipcMain.handle('pet:end-drag', () => endPetDrag());
  ipcMain.handle('pet:body-rect', () => petBodyRect());
  ipcMain.handle('pet:flipped', () => petFlipped());
  ipcMain.handle(
    'pet:resize-bubble',
    (_event, payload: { width?: number; height?: number; persist?: boolean }) =>
      resizeBubble(Number(payload?.width), Number(payload?.height), payload?.persist === true)
  );
  ipcMain.handle('pet:set-enabled', (_event, enabled: boolean) => {
    const next = enabled === true;
    // 从桌宠里点「隐藏」也要落设置，否则重启又冒出来。
    const settings = loadSettings();
    if (settings.general.petEnabled !== next) {
      settings.general.petEnabled = next;
      saveSettings(settings);
      ctx.send('settings:changed', settingsSnapshot());
    }
    setPetEnabled(next);
    // 隐藏桌宠后必须把全局快捷键注销，否则 Ctrl+Shift+D / Ctrl+Alt+S 还能把它叫回来。
    registerPetShortcuts();
  });
  ipcMain.handle('pet:shortcut-status', () => petShortcutStatus());
  ipcMain.handle('pet:shortcuts-status', () => petShortcutsStatus());
  ipcMain.handle('app:close-window', () => {
    setTimeout(() => {
      if (!ctx.win.isDestroyed()) ctx.win.close();
    }, 0);
  });

  ipcMain.handle('app:open-settings', () => {
    ctx.win.show();
    ctx.win.focus();
    ctx.send('ui:open-settings', null);
  });

  ipcMain.handle(
    'ai:set-default-model',
    async (
      _event,
      payload: { platformId?: string; model?: string }
    ): Promise<Result<{ platformId: string; model: string }>> => {
      try {
        const next = loadSettings();
        const platform = next.ai.platforms.find(
          (item) => item.id === String(payload?.platformId || '') && item.enabled !== false
        );
        if (!platform) return { ok: false, error: '服务商不存在或已停用' };
        const model = String(payload?.model || '').trim() || platform.model;
        if (!model) return { ok: false, error: '请选择一个模型' };
        next.ai.defaultModel = { platformId: platform.id, model };
        next.ai.activeId = platform.id;
        platform.model = model;
        saveSettings(next);
        return { ok: true, data: { platformId: platform.id, model } };
      } catch (error) {
        return failure<{ platformId: string; model: string }>(error);
      }
    }
  );

  ipcMain.handle(
    'search:test-fetch',
    async (
      _event,
      payload: { url?: string; platform?: SearchPlatform }
    ): Promise<Result<{ url: string; title: string; chars: number; preview: string }>> => {
      try {
        const url = String(payload?.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: '请填写 http/https 链接' };
        const page = await fetchWebPage(url, 1200, undefined, payload?.platform);
        return {
          ok: true,
          data: {
            url: page.url,
            title: page.title,
            chars: page.text.length,
            preview: page.text.slice(0, 160)
          }
        };
      } catch (error) {
        return failure<{ url: string; title: string; chars: number; preview: string }>(error);
      }
    }
  );

  ipcMain.handle('download:pick-dir', async (): Promise<Result<string | null>> => {
    try {
      const result = await dialog.showOpenDialog(ctx.win, {
        title: '选择下载保存目录',
        properties: ['openDirectory', 'createDirectory']
      });
      return { ok: true, data: result.canceled ? null : result.filePaths[0] || null };
    } catch (error) {
      return failure<string | null>(error);
    }
  });

  ipcMain.handle(
    'dialog:pick-file',
    async (
      _event,
      options?: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }
    ): Promise<Result<string | null>> => {
      try {
        const result = await dialog.showOpenDialog(ctx.win, {
          title: options?.title || '选择文件',
          properties: ['openFile'],
          filters: options?.filters?.length ? options.filters : undefined
        });
        return { ok: true, data: result.canceled ? null : result.filePaths[0] || null };
      } catch (error) {
        return failure<string | null>(error);
      }
    }
  );


  ipcMain.handle('settings:get', (): Result<ReturnType<typeof settingsSnapshot>> => {
    try {
      return { ok: true, data: settingsSnapshot() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'ui:popup-menu',
    async (event, items: Array<{ id?: string; label?: string; type?: 'separator'; enabled?: boolean }>) =>
      new Promise<string | null>((resolve) => {
        const template = (Array.isArray(items) ? items : []).map((item) =>
          item.type === 'separator'
            ? ({ type: 'separator' } as const)
            : {
                label: String(item.label || ''),
                enabled: item.enabled !== false,
                click: () => resolve(item.id || null)
              }
        );
        const menu = Menu.buildFromTemplate(template);
        const win = BrowserWindow.fromWebContents(event.sender) || ctx.win;
        menu.popup({ window: win, callback: () => resolve(null) });
      })
  );

  ipcMain.handle(
    'settings:set',
    async (_event, next: AppSettings): Promise<Result<ReturnType<typeof settingsSnapshot>>> => {
      try {
        const before = loadSettings();
        const saved = saveSettings(next);
        // MCP 配置变了（删除/改地址/改命令）就断开旧会话，避免继续用旧连接。
        for (const old of before.mcp.servers) {
          const current = saved.mcp.servers.find((item) => item.id === old.id);
          const changed =
            !current ||
            current.url !== old.url ||
            current.command !== old.command ||
            (current.args || []).join('\u0000') !== (old.args || []).join('\u0000') ||
            current.transport !== old.transport;
          if (changed) resetMcpSession(old);
        }
        nativeTheme.themeSource = saved.general.theme;
        ctx.tabs.setSuspendMinutes(saved.general.suspendMinutes);
        ctx.tabs.refreshMediaState();
        ctx.tabs.refreshShortcuts();
        setPetEnabled(saved.general.petEnabled === true);
        applyAutoStart(saved.general.autoStart === true);
        await applyProxy(saved);
        applyDictation(saved);
        applyQuickAsk(saved);
        applyRadial(saved, () => ctx.win);
        registerPetShortcuts();
        applyPetSettings();
        await restartBridge(ctx.win);
        const snapshot = settingsSnapshot();
        ctx.send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:wizard',
    async (_event, done: boolean): Promise<Result<ReturnType<typeof settingsSnapshot>>> => {
      try {
        const settings = loadSettings();
        settings.general.wizardDone = done === true;
        saveSettings(settings);
        const snapshot = settingsSnapshot();
        ctx.send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:export',
    async (): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        const result = await dialog.showSaveDialog(ctx.win, {
          title: '导出设置',
          defaultPath: path.join(app.getPath('documents'), 'bsub-settings.json'),
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
        // 导出的设置不含 API Key / 桥 Token；重新导入时保留本机原值。
        fs.writeFileSync(result.filePath, JSON.stringify(settingsForExport(), null, 2), 'utf8');
        return { ok: true, data: { canceled: false, path: result.filePath } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:import',
    async (): Promise<
      Result<{ canceled: boolean; snapshot?: ReturnType<typeof settingsSnapshot> }>
    > => {
      try {
        const result = await dialog.showOpenDialog(ctx.win, {
          title: '导入设置',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        const file = result.filePaths[0];
        if (result.canceled || !file) return { ok: true, data: { canceled: true } };
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as AppSettings;
        const saved = saveSettings(raw);
        nativeTheme.themeSource = saved.general.theme;
        ctx.tabs.setSuspendMinutes(saved.general.suspendMinutes);
        ctx.tabs.refreshShortcuts();
        await restartBridge(ctx.win);
        return { ok: true, data: { canceled: false, snapshot: settingsSnapshot() } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('bridge:status', (): Result<BridgeStatus> => {
    try {
      return { ok: true, data: bridgeStatus() };
    } catch (error) {
      return failure<BridgeStatus>(error);
    }
  });

  ipcMain.handle(
    'bridge:install-extension',
    async (): Promise<Result<{ path: string; browser: string; opened: boolean }>> => {
      try {
        return { ok: true, data: await installBrowserExtension(ctx.win) };
      } catch (error) {
        return failure<{ path: string; browser: string; opened: boolean }>(error);
      }
    }
  );

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) throw new Error('只允许打开 http/https 链接');
    await shell.openExternal(value);
  });

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''));
  });

  ipcMain.handle('update:status', (): Result<UpdateStatus> => {
    try {
      return { ok: true, data: updateStatus() };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:check', async (): Promise<Result<UpdateStatus>> => {
    try {
      return { ok: true, data: await checkForUpdates(true) };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:download', async (): Promise<Result<UpdateStatus>> => {
    try {
      return { ok: true, data: await downloadUpdate() };
    } catch (error) {
      return failure<UpdateStatus>(error);
    }
  });

  ipcMain.handle('update:skip', (_event, version: string) => {
    return { ok: true, data: skipUpdate(version) };
  });

  ipcMain.handle('update:open-releases', async () => {
    await shell.openExternal('https://github.com/Universe366/shizi-extension/releases/latest');
  });

  ipcMain.handle('update:install', () => {
    installUpdate();
  });

  ipcMain.handle(
    'platform:models',
    async (_event, payload: { kind: 'ai' | 'asr'; platform: AiPlatform | AsrPlatform }) => {
      try {
        return { ok: true, data: await probePlatformModels(payload.kind, payload.platform) };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'platform:test',
    async (
      _event,
      payload: {
        kind: 'ai' | 'asr' | 'search';
        platform: AiPlatform | AsrPlatform | SearchPlatform;
      }
    ) => {
      try {
        return { ok: true, data: await testPlatformConnection(payload.kind, payload.platform) };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:sidebar-layout',
    (_event, patch: { width?: number; position?: 'left' | 'right'; collapsed?: boolean }) => {
      try {
        setSidebarLayout(patch || {});
        const snapshot = settingsSnapshot();
        ctx.send('settings:changed', snapshot);
        return { ok: true, data: snapshot };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'settings:tabs-layout',
    (_event, patch: { width?: number; collapsed?: boolean }) => {
      try {
        setTabsLayout(patch || {});
        return { ok: true, data: settingsSnapshot() };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('settings:sidebar-width', (_event, width: number) => {
    try {
      setSidebarWidth(Number(width));
      const snapshot = settingsSnapshot();
      ctx.send('settings:changed', snapshot);
      return { ok: true, data: snapshot };
    } catch (error) {
      return failure(error);
    }
  });

  let dragRestoreTimer: NodeJS.Timeout | null = null;
  let dragActive = false;

  ipcMain.handle('browser:begin-drag', async () => {
    try {
      if (dragRestoreTimer) clearTimeout(dragRestoreTimer);
      dragActive = true;
      const snapshot = await ctx.tabs.captureActiveView();
      if (!dragActive) {
        ctx.tabs.setViewHidden('drag', false);
        return { ok: true, data: null };
      }
      ctx.tabs.setViewHidden('drag', true);
      dragRestoreTimer = setTimeout(() => {
        dragActive = false;
        ctx.tabs.setViewHidden('drag', false);
        dragRestoreTimer = null;
      }, 12000);
      return { ok: true, data: snapshot };
    } catch (error) {
      dragActive = false;
      ctx.tabs.setViewHidden('drag', false);
      return failure(error);
    }
  });

  ipcMain.handle('browser:end-drag', () => {
    dragActive = false;
    if (dragRestoreTimer) {
      clearTimeout(dragRestoreTimer);
      dragRestoreTimer = null;
    }
    ctx.tabs.setViewHidden('drag', false);
  });

  ipcMain.handle('browser:set-visible', (_event, visible: boolean) => {
    ctx.tabs.setActiveViewVisible(visible === true);
  });

  ipcMain.handle('data:backup', async () => {
    try {
      return { ok: true, data: await backupData() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('data:restore', async () => {
    try {
      return { ok: true, data: await restoreData() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('data:change-dir', async () => {
    try {
      const result = await changeDataDir();
      if (result.canceled || !result.target) {
        return { ok: true, data: result };
      }
      await dialog.showMessageBox({
        type: 'info',
        title: '迁移完成',
        message: '数据已迁移到新位置',
        detail: `应用现在会重启，之后将从以下目录读写数据：\n${result.target}${
          result.failed ? `\n\n有 ${result.failed} 个缓存/锁定文件未复制，不影响设置与字幕库。` : ''
        }\n\n旧数据目录会在新进程启动后自动删除。`
      });
      app.relaunch();
      app.exit(0);
      return { ok: true, data: result };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('diagnostics:get', () => {
    try {
      const dataDir = app.getPath('userData');
      const logs = ['startup.log', 'fatal.log']
        .map((name) => {
          const file = path.join(dataDir, name);
          try {
            const stat = fs.statSync(file);
            return { name, size: stat.size, modified: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((item): item is { name: string; size: number; modified: number } => Boolean(item));
      return {
        ok: true,
        data: {
          version: app.getVersion(),
          electron: process.versions.electron || '',
          chrome: process.versions.chrome || '',
          node: process.versions.node || '',
          platform: process.platform,
          arch: process.arch,
          dataDir,
          settingsPath: path.join(dataDir, 'settings.json'),
          dbPath: path.join(dataDir, 'library.db'),
          logs,
          library: listLibrary().stats
        }
      };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('permissions:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearSitePermissions() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('permissions:list', () => {
    try {
      return { ok: true as const, data: permissionSummary() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'permissions:revoke',
    (_event, payload: { origin: string; permission: string }): Result<{ removed: boolean }> => {
      try {
        return {
          ok: true,
          data: {
            removed: revokeSitePermission(
              String(payload?.origin || ''),
              String(payload?.permission || '')
            )
          }
        };
      } catch (error) {
        return failure<{ removed: boolean }>(error);
      }
    }
  );

  ipcMain.handle(
    'diagnostics:export',
    async (): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        return { ok: true, data: await exportDiagnostics() };
      } catch (error) {
        return failure<{ canceled: boolean; path?: string }>(error);
      }
    }
  );

  ipcMain.handle('settings:open-data', async () => {
    await shell.openPath(app.getPath('userData'));
  });
}
