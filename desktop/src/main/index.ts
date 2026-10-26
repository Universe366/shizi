import { app, BrowserWindow, dialog, Tray, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { TabManager } from './tabs';
import { registerIpc } from './ipc';
import { applyAutoStart } from './autoStart';
import { applyProxy } from './proxy';
import { disposeMcpClients } from './mcp';
import { disposeDictation, initDictation } from './dictation';
import { disposeQuickAsk, applyQuickAsk } from './quickAsk';
import { closeChatStore } from './chatStore';
import { setCloseDecisionHandler, setCloseShownHandler } from './ipc/settings';

import {
  closeLibrary,
  initLibrary,
  recordHistory,
} from './library';

import {
  loadSettings,
  migrateSettingsSecrets,
  saveSettings,
} from './settings';
import { installLogger } from './logger';
import { fatal, writeLog } from './log';
import { installPermissionGate } from './permissions';
import { installCsp } from './csp';
import { startBridge, stopBridge } from './bridge';
import { disposeUpdater, initUpdater } from './updater';
import { initPetWindow } from './petWindow';
import { applyDataDirOverride, scheduleOldDataCleanup } from './dataDir';
import { migrateLegacyUserData } from './userDataMigration';
import { loadSession } from './session';
import { createSessionPersister, createTray as createTrayShell } from './shell';
import { APP_NAME } from '../shared/brand';
import { installDownloadHook } from './downloadsHook';
import { registerPetShortcuts, unregisterPetShortcuts } from './petShortcuts';
import { setPetSuppressed } from './petWindow';
import { startTodoReminders } from './todoReminders';
import { foregroundFullscreen } from './ipc/petTools';
import {
  buildUserAgent,
  resolveStartUrl,
  shortcutAction,
  windowFrameOptions
} from './windowPolicy';
import { bootstrapRenderer, handleCloseRequest } from './windowLifecycle';

const UA = buildUserAgent(process.versions.chrome);
const START_URL = resolveStartUrl();

// 自定义数据目录必须早于任何 userData 读写；环境变量仅用于开发期覆盖。
let migrationFallback: string | null = null;
if (!process.env.BSUB_USER_DATA) {
  const migration = migrateLegacyUserData();
  if (migration.result.status !== 'none') {
    console.log('[data] legacy migration', migration.result.status, migration.result.target || '');
  }
  if (migration.result.status === 'failed') {
    migrationFallback = migration.fallback || null;
    console.warn('[data] migration failed, fallback:', migration.result.error || 'unknown');
  }
}
const dataDirOverride = applyDataDirOverride();
if (!dataDirOverride && migrationFallback && !process.env.BSUB_USER_DATA) {
  try {
    app.setPath('userData', migrationFallback);
    console.warn('[data] using legacy userData:', migrationFallback);
  } catch {
    // ignore
  }
}
if (process.env.BSUB_USER_DATA) {
  try {
    fs.mkdirSync(process.env.BSUB_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.BSUB_USER_DATA);
  } catch (error) {
    console.warn('[app] 无法设置 userData:', (error as Error).message);
  }
}
writeLog('startup.log', `boot packaged=${app.isPackaged} dataDir=${dataDirOverride || ''}`);

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let closingChoicePending = false;

// 双开会共用 library.db 和桥端口，第二个实例启动时还会把第一个实例的
// running 任务标成「应用退出」——必须只允许一个实例。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow();
    const url = argv.find((arg) => /^https?:\/\//i.test(arg));
    if (url && tabManager) void tabManager.create(url);
  });
}

function resolveResource(name: string): string | null {
  const candidates = [
    path.join(process.resourcesPath, name),
    path.join(app.getAppPath(), 'resources', name)
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return file;
    } catch {
      // 尝试下一个
    }
  }
  return null;
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    if (mainWindow) void startBridge(mainWindow);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const sessionPersister = createSessionPersister(() => tabManager);

function createTray(): void {
  if (tray) return;
  tray = createTrayShell({
    iconPath: resolveResource('tray.png'),
    tooltip: APP_NAME,
    onShow: () => showWindow(),
    onQuit: () => {
      isQuitting = true;
    }
  });
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    ...windowFrameOptions({
      dark,
      preloadPath: path.join(__dirname, '../preload/index.js')
    }),
    title: APP_NAME
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const action = shortcutAction(input);
    if (!action) return;
    if (action === 'exit-fullscreen') {
      if (!mainWindow?.isFullScreen()) return;
      event.preventDefault();
      void tabManager
        ?.activeWebContents()
        ?.executeJavaScript(
          'document.fullscreenElement ? document.exitFullscreen().catch(() => null) : null'
        )
        .catch(() => undefined);
      mainWindow.setFullScreen(false);
      return;
    }
    event.preventDefault();
    if (action === 'zoom-in') tabManager?.zoomIn();
    else if (action === 'zoom-out') tabManager?.zoomOut();
    else if (action === 'zoom-reset') tabManager?.zoomReset();
    else if (action === 'toggle-fullscreen') mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    else if (action === 'quit') app.quit();
  });

  tabManager = new TabManager(
    mainWindow,
    (tabs) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tabs:changed', tabs);
        mainWindow.webContents.send('tabs:groups', tabManager?.groupsList() ?? []);
      }
      sessionPersister.schedule();
    },
    (result) => {
      if (!app.isPackaged) {
        console.log(
          '[find]',
          result.tabId.slice(0, 8),
          `${result.activeMatchOrdinal}/${result.matches}`,
          `final=${result.finalUpdate}`
        );
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('find:result', result);
      }
    },
    (visit) => {
      try {
        recordHistory(visit);
      } catch (error) {
        console.warn('[history] 记录失败:', (error as Error).message);
      }
    }
  );
  registerIpc(mainWindow, tabManager);
  initDictation(mainWindow, loadSettings());
  applyQuickAsk(loadSettings());
  tabManager.setSuspendMinutes(loadSettings().general.suspendMinutes);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void tabManager?.create(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[m0] userData', app.getPath('userData'));
    console.log('[m0] start', START_URL);
    void bootstrapRenderer({
      loadSettings: () => loadSettings(),
      loadSession,
      manager: tabManager,
      startUrl: START_URL,
      packaged: app.isPackaged,
      enableDevHooks: process.env.BSUB_ENABLE_DEV_HOOKS === '1',
      // 开发探针不进生产包：按需动态加载。
      runDevHooks: async () => {
        if (!mainWindow || !tabManager) return;
        const { runDevHooks } = await import('./devHooks');
        runDevHooks(mainWindow, tabManager);
      }
    });
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log('[renderer]', `[${level}]`, message, `${sourceId}:${line}`);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.warn('[renderer] gone', details);
    });
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const diag = await mainWindow.webContents.executeJavaScript(
          `({ api: typeof window.bsub, rootChildren: document.querySelector('#root') ? document.querySelector('#root').children.length : -1, text: (document.body.innerText || '').slice(0, 300) })`
        );
        console.log('[diag]', JSON.stringify(diag));
      } catch (error) {
        console.warn('[diag] failed', (error as Error).message);
      }
    }, 7000);
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const section = process.env.BSUB_START_SECTION;
  if (rendererUrl) {
    void mainWindow.loadURL(
      section ? `${rendererUrl}?section=${encodeURIComponent(section)}` : rendererUrl
    );
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      section ? { query: { section } } : undefined
    );
  }

  const askCloseFromRenderer = (): Promise<
    { choice: 'tray' | 'quit' | 'cancel'; remember: boolean } | null
  > => {
    const target = mainWindow;
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) {
      return Promise.resolve(null);
    }
    // 原生网页视图永远盖在 renderer 上面，关闭框必须先把页面藏起来。
    // 不能只等渲染层自己隐藏（它可能正忙、事件晚到），否则弹窗被网页盖住，
    // 用户只看到背景变模糊、以为程序卡死。
    tabManager?.setViewHidden('close', true);
    return new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const finish = (
        value: { choice: 'tray' | 'quit' | 'cancel'; remember: boolean } | null
      ) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        setCloseDecisionHandler(null);
        setCloseShownHandler(null);
        tabManager?.setViewHidden('close', false);
        if (!value) {
          // 自定义关闭框超时/被打断：通知渲染层收起模糊遮罩，再走原生兜底。
          try {
            if (!target.webContents.isDestroyed()) target.webContents.send('app:close-cancel');
          } catch {
            // ignore
          }
        }
        resolve(value);
      };
      // 只等「关闭框画出来」这一小段；画出来之后交给用户慢慢决定，
      // 不再用固定超时把正在看的弹窗换成系统对话框。
      timer = setTimeout(() => finish(null), 8000);
      setCloseShownHandler(() => {
        if (settled) return;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      });
      setCloseDecisionHandler((payload) => {
        const choice = payload?.choice;
        if (choice !== 'tray' && choice !== 'quit' && choice !== 'cancel') return;
        finish({ choice, remember: payload?.remember === true });
      });
      try {
        target.webContents.send('app:close-request');
      } catch {
        finish(null);
      }
    });
  };

  mainWindow.on('leave-full-screen', () => {
    // 全屏退出时窗口尺寸变化比 renderer 的布局上报慢；补一次强制重绘，
    // 避免网页区域停在白底。
    setTimeout(() => tabManager?.refreshActiveView(), 180).unref?.();
  });

  mainWindow.on('close', (event) => {
    handleCloseRequest(
      event,
      { isQuitting, choicePending: closingChoicePending },
      {
        settings: loadSettings(),
        windowTitle: APP_NAME,
        hideWindow: () => mainWindow?.hide(),
        quit: () => app.quit(),
        askClose: askCloseFromRenderer,
        showMessageBox: (options) => dialog.showMessageBox(mainWindow as BrowserWindow, options),
        loadSettings: () => loadSettings(),
        saveSettings: (settings) => saveSettings(settings),
        setChoicePending: (pending) => {
          closingChoicePending = pending;
        },
        setQuitting: (value) => {
          isQuitting = value;
        }
      }
    );
  });

  mainWindow.on('closed', () => {
    tabManager?.dispose();
    tabManager = null;
    mainWindow = null;
  });
}

app
  .whenReady()
  .then(() => {
    if (!hasSingleInstanceLock) return;
    installLogger();
    writeLog('startup.log', 'ready');
    migrateSettingsSecrets();
    nativeTheme.themeSource = loadSettings().general.theme;
    applyAutoStart(loadSettings().general.autoStart === true);
    void applyProxy(loadSettings());
    startTodoReminders();
    let externalFullscreen = false;
    let lastExternalCheck = 0;
    let checkingFullscreen = false;
    const fullscreenTimer = setInterval(() => {
      if (checkingFullscreen) return;
      const settings = loadSettings();
      if (settings.general.petEnabled !== true || settings.general.petHideFullscreen === false) {
        setPetSuppressed(false);
        return;
      }
      checkingFullscreen = true;
      void (async () => {
        let inApp = false;
        const wc = tabManager?.activeWebContents();
        if (wc && !wc.isDestroyed()) {
          try {
            inApp = (await wc.executeJavaScript('Boolean(document.fullscreenElement)')) === true;
          } catch {
            inApp = false;
          }
        }
        if (Date.now() - lastExternalCheck > 4000) {
          lastExternalCheck = Date.now();
          try {
            const foreground = await foregroundFullscreen();
            externalFullscreen =
              foreground.fullscreen && !/electron|拾字|shizi/i.test(foreground.process);
          } catch {
            externalFullscreen = false;
          }
        }
        setPetSuppressed(inApp || externalFullscreen);
      })().finally(() => {
        checkingFullscreen = false;
      });
    }, 1500);
    fullscreenTimer.unref?.();
    if (process.platform === 'win32') app.setAppUserModelId('com.shizi.desktop');
    session.defaultSession.setUserAgent(UA);
    installDownloadHook(() => mainWindow);
    initLibrary();
    writeLog('startup.log', 'library ready');
    scheduleOldDataCleanup();
    // 先装权限闸门和 CSP，再创建窗口：CSP 监听必须在 renderer 发起请求前注册。
    installPermissionGate(() =>
      mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null
    );
    installCsp(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null));
    createWindow();
    writeLog('startup.log', 'window created');
    createTray();
    initPetWindow();
    registerPetShortcuts();
    if (mainWindow) {
      void startBridge(mainWindow);
      initUpdater(mainWindow);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        if (mainWindow) void startBridge(mainWindow);
      } else {
        showWindow();
      }
    });
  })
  .catch((error) => {
    fatal('whenReady', error);
  });

app.on('before-quit', () => {
  writeLog('startup.log', 'before-quit');
  isQuitting = true;
  // 退出时视频还在播的话，恢复会话会“接着响”；先暂停所有标签的媒体。
  tabManager?.pauseAllMedia();
  sessionPersister.persist();
  unregisterPetShortcuts();
  disposeUpdater();
  stopBridge();
  disposeMcpClients();
  disposeDictation();
  disposeQuickAsk();
  closeChatStore();
  closeLibrary();
});

app.on('window-all-closed', () => {
  writeLog('startup.log', 'window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('render-process-gone', (_event, webContents, details) => {
  writeLog('fatal.log', `render-process-gone ${webContents.getURL()} ${JSON.stringify(details)}`);
});

app.on('child-process-gone', (_event, details) => {
  writeLog('fatal.log', `child-process-gone ${JSON.stringify(details)}`);
});
