import { app, BrowserWindow, Menu, clipboard, nativeTheme, session, WebContentsView } from 'electron';
import type { MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FindResult, LayoutRect, TabGroup, TabInfo } from '../shared/types';
import type { SearchEngineId } from '../shared/searchEngines';
import { normalizeUrl } from './url';
import { neighborAfterClose } from './tabOrder';
import { SELECTION_TOOLBAR_SCRIPT } from './selectionToolbar';
import { MEDIA_CONTROL_SCRIPT } from './mediaControl';
import { AUTOPLAY_GUARD_SCRIPT } from './autoplayGuard';
import {
  actionForStroke,
  effectiveShortcuts,
  shortcutDisplay,
  type ShortcutActionId
} from '../shared/shortcuts';
import { strokeFromEvent } from '../shared/shortcutKeys';
import { loadSettings, saveSettings } from './settings';
import {
  clampMediaRate,
  mediaSiteKey,
  resolveMediaRate,
  sanitizeMediaSiteRates
} from '../shared/media';

// 后台标签闲置多久后释放渲染进程。环境变量用于测试覆盖。
const ENV_SUSPEND_MS = Number(process.env.BSUB_SUSPEND_MS) || 0;
const DEFAULT_SUSPEND_MS = 5 * 60 * 1000;

const KEY_TO_CODE: Record<string, string> = {
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  ' ': 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert'
};

/** before-input-event 的 code 有时为空（合成事件/旧版本），按 key 反推。 */
function inputCode(input: { code?: string; key: string }): string {
  if (input.code) return input.code;
  const key = input.key;
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  if (/^F\d{1,2}$/.test(key)) return key;
  return KEY_TO_CODE[key] || '';
}

interface TabRecord {
  id: string;
  view: WebContentsView | null;
  title: string;
  url: string;
  loading: boolean;
  favicon?: string;
  suspended: boolean;
  lastActiveAt: number;
  zoom: number;
  /** 该标签的播放倍速（每个标签独立，便于按站点记忆） */
  rate: number;
  pinned?: boolean;
  audible?: boolean;
  muted?: boolean;
  groupId?: string;
  lastHttpUrl?: string;
  loadPromise?: Promise<void>;
  /** 会话恢复的标签：用户操作前不让页面自动播放。 */
  suppressAutoplay?: boolean;
}

/** 后台标签的 WebContentsView 不可见时 capturePage 取不到画面，切走前先留一张缩略图。 */
interface TabPreviewShot {
  dataUrl: string;
  at: number;
}

let bridgeCache: string | null = null;

function tabKey(value: string): string {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return value;
    parsed.hash = '';
    // 时间戳参数只决定播放位置，同一视频仍算同一个标签。
    parsed.searchParams.delete('t');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return value;
  }
}

function bridgeSource(): string {
  if (bridgeCache) return bridgeCache;
  const candidates = [
    path.join(process.resourcesPath, 'page-bridge.js'),
    path.join(app.getAppPath(), 'resources/page-bridge.js'),
    path.resolve(app.getAppPath(), '../shizi-extension/src/content/page-bridge.js')
  ];
  for (const file of candidates) {
    try {
      bridgeCache = fs.readFileSync(file, 'utf8');
      return bridgeCache;
    } catch {
      // 尝试下一个候选路径
    }
  }
  throw new Error('找不到 page-bridge.js，请先运行 npm run sync:bridge');
}

function searchPref(): { engine: SearchEngineId; customUrl: string } {
  const general = loadSettings().general;
  return { engine: general.searchEngine || 'bing', customUrl: general.searchEngineCustom || '' };
}

export class TabManager {
  private readonly tabs = new Map<string, TabRecord>();
  private readonly creating = new Map<string, Promise<void>>();
  private activeId: string | null = null;
  private bounds: LayoutRect = { x: 0, y: 0, width: 0, height: 0 };
  private suspendAfterMs = ENV_SUSPEND_MS > 0 ? Math.max(2000, ENV_SUSPEND_MS) : DEFAULT_SUSPEND_MS;
  private suspendTimer: NodeJS.Timeout | null = null;
  private audioTimer: NodeJS.Timeout | null = null;
  // Ctrl+Shift+T 用：最近关掉的标签（最多 20 个）。
  private readonly closedStack: Array<{ url: string; title: string }> = [];
  private readonly groups = new Map<string, TabGroup>();
  private readonly previewShots = new Map<string, TabPreviewShot>();
  /** 当前生效的快捷键（动作 id → 键位），保存设置后刷新。 */
  private shortcutMap: Record<ShortcutActionId, string> = effectiveShortcuts(
    loadSettings().general.shortcuts
  );
  /** 倍速落盘节流：拖动滑块/长按快捷键时只保留最后一次。 */
  private pendingRateSave: { site: string; rate: number } | null = null;
  private rateSaveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly onChanged: (tabs: TabInfo[]) => void,
    private readonly onFindResult?: (result: FindResult) => void,
    private readonly onVisited?: (visit: { url: string; title: string; favicon?: string }) => void
  ) {
    this.startSuspendTimer();
    this.audioTimer = setInterval(() => this.refreshAudioState(), 1000);
    this.audioTimer.unref?.();
  }

  private refreshAudioState(): void {
    let changed = false;
    for (const record of this.tabs.values()) {
      if (!record.view || record.suspended) continue;
      try {
        const wc = record.view.webContents;
        if (wc.isDestroyed()) continue;
        const audible = wc.isCurrentlyAudible();
        const muted = wc.isAudioMuted();
        if (record.audible !== audible || record.muted !== muted) {
          record.audible = audible;
          record.muted = muted;
          changed = true;
        }
      } catch {
        // ignore
      }
    }
    if (changed) this.emit();
  }

  private startSuspendTimer(): void {
    if (this.suspendTimer) clearInterval(this.suspendTimer);
    const checkMs = Math.min(30000, Math.max(1000, Math.floor(this.suspendAfterMs / 2)));
    this.suspendTimer = setInterval(() => this.suspendIdle(), checkMs);
    this.suspendTimer.unref?.();
  }

  setSuspendMinutes(minutes: number): void {
    if (ENV_SUSPEND_MS > 0) return;
    const safe = Math.min(120, Math.max(1, Math.round(minutes || 5)));
    this.suspendAfterMs = safe * 60 * 1000;
    this.startSuspendTimer();
  }

  async create(
    input = 'https://www.bilibili.com/',
    options: { activate?: boolean; wait?: boolean; suppressAutoplay?: boolean } = {}
  ): Promise<string> {
    const id = randomUUID();
    const url = normalizeUrl(input, searchPref());
    const record: TabRecord = {
      id,
      view: null,
      title: '新标签页',
      url,
      suppressAutoplay: options.suppressAutoplay === true,
      lastHttpUrl: /^https?:/i.test(url) ? url : undefined,
      loading: true,
      suspended: false,
      audible: false,
      muted: false,
      lastActiveAt: Date.now(),
      zoom: 1,
      rate: resolveMediaRate(loadSettings().general, url)
    };
    this.tabs.set(id, record);

    await this.ensureView(record);
    if (options.activate === false) {
      try {
        record.view?.setVisible(false);
      } catch {
        // ignore
      }
    } else {
      this.setActive(id);
    }
    console.log('[tab] created', id, url, `suspendAfter=${this.suspendAfterMs}ms`);
    this.emit();
    if (options.wait && record.loadPromise) {
      await record.loadPromise.catch(() => undefined);
    }
    return id;
  }

  // 创建（或重建）一个标签的 WebContentsView。休眠标签恢复时也走这里。
  private ensureView(record: TabRecord): Promise<void> {
    if (record.view) return Promise.resolve();
    const existing = this.creating.get(record.id);
    if (existing) return existing;

    const task = (async () => {
      const view = new WebContentsView({
        webPreferences: {
          session: session.defaultSession,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      });
      // 与 renderer 里的圆角卡片对齐：外框 14、边框 1，内层页面的圆角用 13。
      view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#15181e' : '#f7f6f3');
      try {
        view.setBorderRadius(13);
      } catch {
        // 个别平台不支持圆角，退化成直角页面。
      }
      view.webContents.setZoomFactor(record.zoom || 1);

      record.view = view;
      record.suspended = false;
      record.loading = true;

      this.win.contentView.addChildView(view);
      view.setBounds(this.bounds);
      // 向导/拖拽期间 activeViewVisible 可能是 false：
      // 新建视图不能无脑显示，否则会把向导遮罩盖住。
      view.setVisible(this.activeViewVisible);
      this.wire(record);

      // prepare 会先导航到 about:blank 来挂 CDP；这里先把目标地址记下来，
      // 避免 about:blank 的导航事件把 record.url 覆盖掉。
      const target = record.url || 'about:blank';

      // 必须先加载一次，CDP 才能正常挂上；随后注入 page-bridge。
      await this.prepare(view, record.suppressAutoplay === true);
      // 拦截脚本只对「恢复出来的这一页」生效；之后用户自己导航/休眠重建不再拦。
      record.suppressAutoplay = false;
      record.url = target;

      void view.webContents
        .loadURL(target)
        .then(async () => {
          const version = await view.webContents
            .executeJavaScript('window.__BSUB_PAGE_BRIDGE__?.version ?? null')
            .catch(() => null);
          console.log('[tab] page ready', target, 'bridge=', version);
        })
        .catch((err: Error) => {
          console.warn('[tab] loadURL 失败', target, err.message);
        });

      this.emit();
    })();

    this.creating.set(record.id, task);
    return task.finally(() => {
      this.creating.delete(record.id);
    });
  }

  private async prepare(view: WebContentsView, suppressAutoplay = false): Promise<void> {
    const wc = view.webContents;
    try {
      await wc.loadURL('about:blank');
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.enable');
      if (suppressAutoplay) {
        await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: AUTOPLAY_GUARD_SCRIPT
        });
      }
      await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: bridgeSource()
      });
      await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: MEDIA_CONTROL_SCRIPT
      });
      // 页内倍速面板 / 快捷键通过 binding 把动作送回主进程。
      await wc.debugger.sendCommand('Runtime.enable');
      await wc.debugger.sendCommand('Runtime.addBinding', {
        name: '__bsubMediaAction'
      });
      if (loadSettings().general.selectionToolbar !== false) {
        await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: SELECTION_TOOLBAR_SCRIPT
        });
        await wc.debugger.sendCommand('Runtime.addBinding', {
          name: '__bsubSelectionAction'
        });
        wc.debugger.on('message', (_event, method, params) => {
          if (method !== 'Runtime.bindingCalled' || params?.name !== '__bsubSelectionAction') {
            return;
          }
          try {
            const data = JSON.parse(String(params.payload || '{}')) as {
              action?: string;
              text?: string;
            };
            const text = String(data.text || '').slice(0, 4000);
            if (!text) return;
            const action = ['explain', 'translate', 'summarize'].includes(String(data.action))
              ? String(data.action)
              : 'explain';
            this.win.webContents.send('app:selection-action', { action, text });
          } catch (error) {
            console.warn('[selection] 解析划词动作失败:', (error as Error).message);
          }
        });
      }
    } catch (err) {
      console.warn('[tab] 注入 page-bridge 失败:', (err as Error).message);
    }
  }

  private wire(record: TabRecord): void {
    const view = record.view;
    if (!view) return;
    const wc = view.webContents;
    const touch = () => this.emit();
    const ownerWindow = () => BrowserWindow.fromWebContents(wc);

    wc.debugger.on('message', (_event, method, params) => {
      if (method !== 'Runtime.bindingCalled' || params?.name !== '__bsubMediaAction') return;
      this.handleMediaAction(record, String(params?.payload || ''));
    });

    wc.on('dom-ready', () => {
      void this.pushMediaState(record);
    });

    wc.on('context-menu', (_event, params) => {
      const selected = String(params.selectionText || '').trim();
      const pageUrl = params.pageURL || record.url;
      const sendAction = (action: string) => {
        this.win.webContents.send('web:context-action', {
          action,
          text: selected.slice(0, 8000),
          url: pageUrl
        });
      };
      const template: MenuItemConstructorOptions[] = [];
      if (selected) {
        template.push(
          { label: '用 AI 解释选中', click: () => sendAction('explain') },
          { label: '用 AI 翻译选中', click: () => sendAction('translate') },
          { label: '用 AI 总结选中', click: () => sendAction('summarize') },
          { label: '用 AI 提问选中', click: () => sendAction('ask') },
          { label: '朗读选中', click: () => sendAction('speak') },
          { label: '搜索选中', click: () => sendAction('search') },
          {
            label: '复制选中',
            click: () => {
              clipboard.writeText(selected);
            }
          },
          { type: 'separator' }
        );
      }
      template.push(
        { label: '用 AI 总结本页', click: () => sendAction('summarize-page') },
        { label: '就当前页面提问', click: () => sendAction('ask-page') },
        { label: '复制页面链接', click: () => clipboard.writeText(pageUrl) },
        { type: 'separator' },
        { label: '后退', enabled: wc.canGoBack(), click: () => wc.goBack() },
        { label: '前进', enabled: wc.canGoForward(), click: () => wc.goForward() },
        { label: '刷新', click: () => wc.reload() }
      );
      Menu.buildFromTemplate(template).popup({ window: ownerWindow() || this.win });
    });
    wc.on('did-frame-finish-load', () => {
      void this.pushMediaState(record);
    });

    wc.on('enter-html-full-screen', () => {
      const win = ownerWindow();
      if (win && !win.isFullScreen()) win.setFullScreen(true);
    });
    wc.on('leave-html-full-screen', () => {
      const win = ownerWindow();
      if (win?.isFullScreen()) win.setFullScreen(false);
      // 退出全屏是尺寸/合成器状态变化最大的一步：等窗口真正缩回去再重报一次，
      // 否则原生视图可能停在旧尺寸上，表现成整块白屏。
      setTimeout(() => {
        if (record.view && !record.view.webContents.isDestroyed()) {
          this.refreshActiveView();
        }
      }, 180).unref?.();
    });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const win = ownerWindow();
      if (input.key === 'Escape') {
        if (!win?.isFullScreen()) return;
        event.preventDefault();
        void wc
          .executeJavaScript(
            'document.fullscreenElement ? document.exitFullscreen().catch(() => null) : null'
          )
          .catch(() => undefined);
        win.setFullScreen(false);
        return;
      }
      if (input.key === 'F11') {
        event.preventDefault();
        win?.setFullScreen(!win.isFullScreen());
        return;
      }
      if (input.control && (input.key === '=' || input.key === '+')) {
        event.preventDefault();
        this.zoomIn();
        return;
      }
      if (input.control && (input.key === '-' || input.key === '_')) {
        event.preventDefault();
        this.zoomOut();
        return;
      }
      if (input.control && input.key === '0') {
        event.preventDefault();
        this.zoomReset();
        return;
      }
      // 可自定义动作：与渲染层共用 actionForStroke（用 code 匹配，避免 Ctrl+Shift+3 变 '#'）。
      const action = actionForStroke(
        strokeFromEvent({
          code: inputCode(input),
          ctrlKey: input.control,
          altKey: input.alt,
          shiftKey: input.shift,
          metaKey: input.meta
        }),
        this.shortcutMap,
        'page'
      );
      if (action) {
        event.preventDefault();
        this.win.webContents.send('app:shortcut', action);
        return;
      }
      if (input.control && input.shift && input.key.toLowerCase() === 'q') {
        event.preventDefault();
        app.quit();
      }
    });

    wc.on('page-title-updated', (_event, title) => {
      if (!title || title === 'about:blank') return;
      record.title = title;
      if (record.url && /^https?:/i.test(record.url)) {
        this.onVisited?.({ url: record.url, title, favicon: record.favicon });
      }
      touch();
    });
    wc.on('page-favicon-updated', (_event, icons) => {
      record.favicon = icons[0];
      if (record.url && /^https?:/i.test(record.url)) {
        this.onVisited?.({ url: record.url, title: record.title, favicon: record.favicon });
      }
      touch();
    });
    wc.on('did-navigate', (_event, url) => {
      if (!url || url === 'about:blank') return;
      record.url = url;
      if (/^https?:/i.test(url)) record.lastHttpUrl = url;
      if (/^https?:/i.test(url)) {
        this.onVisited?.({ url, title: record.title, favicon: record.favicon });
      }
      // 新页面沿用站点记忆 / 默认倍速；真正的下发在 dom-ready 之后。
      record.rate = this.resolveRateFor(url);
      this.previewShots.delete(record.id);
      touch();
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      if (!url || url === 'about:blank') return;
      record.url = url;
      if (/^https?:/i.test(url)) record.lastHttpUrl = url;
      if (/^https?:/i.test(url)) {
        this.onVisited?.({ url, title: record.title, favicon: record.favicon });
      }
      touch();
    });
    wc.on('did-start-loading', () => {
      record.loading = true;
      touch();
    });
    wc.on('did-stop-loading', () => {
      record.loading = false;
      void this.pushMediaState(record);
      if (this.activeId === record.id) {
        const timer = setTimeout(() => {
          void this.capturePreview(record);
        }, 350);
        timer.unref?.();
      }
      touch();
    });
    wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      record.loading = false;
      console.warn('[tab] 加载失败', code, description, url);
      touch();
    });

    wc.on('zoom-changed', (_event, direction) => {
      // Ctrl + 滚轮：Chromium 只发方向，这里自己套用同样的 ±10% 步进。
      if (direction === 'in') this.zoomIn();
      else this.zoomOut();
    });

    wc.setWindowOpenHandler(({ url }) => {
      void this.create(url);
      return { action: 'deny' };
    });

    wc.on('found-in-page', (_event, result) => {
      this.onFindResult?.({
        tabId: record.id,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        finalUpdate: result.finalUpdate
      });
    });

    wc.on('context-menu', (_event, params) => {
      const canBack = (() => {
        try {
          return wc.navigationHistory.canGoBack();
        } catch {
          return false;
        }
      })();
      const canForward = (() => {
        try {
          return wc.navigationHistory.canGoForward();
        } catch {
          return false;
        }
      })();

      const template: MenuItemConstructorOptions[] = [
        {
          label: '后退',
          enabled: canBack,
          click: () => wc.navigationHistory.goBack()
        },
        {
          label: '前进',
          enabled: canForward,
          click: () => wc.navigationHistory.goForward()
        },
        { label: '刷新', click: () => wc.reload() },
        { type: 'separator' },
        {
          label: '复制',
          enabled: Boolean(params.selectionText),
          click: () => clipboard.writeText(params.selectionText)
        }
      ];

      if (params.isEditable) {
        template.push(
          { label: '粘贴', enabled: params.editFlags.canPaste, click: () => wc.paste() },
          { label: '全选', click: () => wc.selectAll() }
        );
      }

      if (params.linkURL) {
        template.push(
          { type: 'separator' },
          {
            label: '在新标签页打开链接',
            click: () => {
              void this.create(params.linkURL);
            }
          },
          { label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) }
        );
      }

      if (!app.isPackaged) {
        template.push(
          { type: 'separator' },
          { label: '检查元素', click: () => wc.inspectElement(params.x, params.y) }
        );
      }

      Menu.buildFromTemplate(template).popup({ window: this.win });
    });
  }

  private setActive(id: string): void {
    const previousId = this.activeId;
    if (previousId && previousId !== id) {
      // 必须赶在 setVisible(false) 之前抓，否则后台视图取不到画面。
      const previous = this.tabs.get(previousId);
      if (previous?.view) void this.capturePreview(previous);
    }
    this.activeId = id;
    const active = this.tabs.get(id);
    if (active) active.lastActiveAt = Date.now();

    for (const [tabId, record] of this.tabs) {
      if (!record.view) continue;
      try {
        record.view.setVisible(tabId === id && this.activeViewVisible);
      } catch {
        // setVisible 不可用时忽略
      }
    }
    if (active && active.view) active.view.setBounds(this.bounds);
    if (active?.view && !active.suspended) {
      const timer = setTimeout(() => {
        void this.capturePreview(active);
      }, 500);
      timer.unref?.();
    }
    this.emit();
  }

  async activate(id: string): Promise<void> {
    if (!this.tabs.has(id) || this.activeId === id) return;
    const record = this.tabs.get(id);
    if (!record) return;
    // 已休眠的标签在切回时才重建，页面重新加载（后台状态本来也不该保留）。
    if (!record.view || record.suspended) await this.ensureView(record);
    this.setActive(id);
  }

  /**
   * 从库/历史里打开视频：同一视频已经开着就切过去，不再堆重复标签。
   * `?t=` 只影响播放位置，不参与匹配；`ready` 为 false 时页面还在加载，
   * 调用方不要立刻 seek。
   */
  async openOrActivate(
    input: string
  ): Promise<{ id: string; reused: boolean; ready: boolean }> {
    const url = normalizeUrl(input, searchPref());
    const key = tabKey(url);
    for (const [id, record] of this.tabs) {
      if (!record.url || tabKey(record.url) !== key) continue;
      const ready = Boolean(record.view) && !record.suspended && !record.loading;
      await this.activate(id);
      return { id, reused: true, ready };
    }
    const id = await this.create(url);
    return { id, reused: false, ready: true };
  }

  close(id: string, nextId?: string): void {
    const record = this.tabs.get(id);
    if (!record) return;
    const order = [...this.tabs.keys()];

    const closeUrl = /^https?:/i.test(record.url) ? record.url : record.lastHttpUrl || '';
    if (closeUrl) {
      this.closedStack.push({ url: closeUrl, title: record.title || '' });
      if (this.closedStack.length > 20) this.closedStack.shift();
    }

    this.tabs.delete(id);
    this.previewShots.delete(id);
    if (record.groupId) {
      const group = this.groups.get(record.groupId);
      if (group && ![...this.tabs.values()].some((item) => item.groupId === group.id)) {
        this.groups.delete(group.id);
      }
    }
    this.releaseView(record);

    if (this.activeId === id) {
      // 渲染层知道固定/分组后的真实显示顺序，优先采用它给的邻居。
      const preferred =
        nextId && nextId !== id && this.tabs.has(nextId) ? nextId : null;
      const next = preferred ?? neighborAfterClose(order, id);
      this.activeId = next;
      if (next) {
        const nextRecord = this.tabs.get(next);
        if (nextRecord) {
          if (!nextRecord.view || nextRecord.suspended) {
            void this.ensureView(nextRecord).then(() => {
              if (this.activeId === next) this.setActive(next);
            });
          } else {
            try {
              nextRecord.view.setVisible(this.activeViewVisible);
            } catch {
              // ignore
            }
            nextRecord.view.setBounds(this.bounds);
          }
        }
      }
    }
    this.emit();
  }

  /** 拖拽排序：把标签移动到最后一次落点，Map 的插入顺序就是展示顺序。 */
  setMuted(id: string, muted: boolean): void {
    const record = this.tabs.get(id);
    if (!record) return;
    record.muted = muted === true;
    try {
      record.view?.webContents.setAudioMuted(record.muted);
    } catch {
      // ignore
    }
    this.emit();
  }

  async sleepTab(id: string): Promise<boolean> {
    const record = this.tabs.get(id);
    if (!record || record.suspended || id === this.activeId) return false;
    this.suspend(record);
    return true;
  }

  async wakeTab(id: string): Promise<boolean> {
    const record = this.tabs.get(id);
    if (!record) return false;
    if (record.suspended) {
      await this.ensureView(record);
      record.suspended = false;
      this.emit();
    }
    await this.activate(id);
    return true;
  }

  closedTabs(): Array<{ url: string; title: string }> {
    return [...this.closedStack].reverse().slice(0, 8);
  }

  reopenClosedAt(index: number): Promise<string> | null {
    const position = this.closedStack.length - 1 - index;
    if (position < 0 || position >= this.closedStack.length) return null;
    const [entry] = this.closedStack.splice(position, 1);
    return this.create(entry.url);
  }

  groupsList(): TabGroup[] {
    return [...this.groups.values()];
  }

  createGroup(name: string, color: TabGroup['color'] = 'blue'): TabGroup {
    const group: TabGroup = {
      id: `g-${randomUUID().slice(0, 8)}`,
      name: String(name || '新分组').trim().slice(0, 24) || '新分组',
      color,
      collapsed: false
    };
    this.groups.set(group.id, group);
    this.emit();
    return group;
  }

  assignGroup(tabId: string, groupId: string | null): void {
    const record = this.tabs.get(tabId);
    if (!record) return;
    if (groupId && !this.groups.has(groupId)) return;
    record.groupId = groupId || undefined;
    this.emit();
  }

  renameGroup(id: string, name: string): void {
    const group = this.groups.get(id);
    if (!group) return;
    group.name = String(name || '').trim().slice(0, 24) || group.name;
    this.emit();
  }

  setGroupColor(id: string, color: TabGroup['color']): void {
    const group = this.groups.get(id);
    if (!group) return;
    group.color = color;
    this.emit();
  }

  toggleGroupCollapsed(id: string): void {
    const group = this.groups.get(id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.emit();
  }

  closeGroup(id: string): void {
    const ids = [...this.tabs.values()].filter((record) => record.groupId === id).map((r) => r.id);
    for (const tabId of ids) void this.close(tabId);
    this.groups.delete(id);
    this.emit();
  }

  restoreGroups(
    groups: TabGroup[],
    assignments: Array<{ tabId: string; groupId?: string; pinned?: boolean }>
  ): void {
    for (const group of groups) {
      if (!group || !group.id) continue;
      this.groups.set(group.id, {
        id: group.id,
        name: String(group.name || '分组').slice(0, 24),
        color: group.color || 'blue',
        collapsed: group.collapsed === true
      });
    }
    for (const item of assignments) {
      const record = this.tabs.get(item.tabId);
      if (!record) continue;
      if (item.groupId && this.groups.has(item.groupId)) record.groupId = item.groupId;
      if (item.pinned) record.pinned = true;
    }
    this.emit();
  }

  pin(id: string, pinned: boolean): void {
    const record = this.tabs.get(id);
    if (!record) return;
    record.pinned = pinned === true;
    // 固定区在前：重建 Map 顺序，保证 list() 与 Ctrl+Tab 顺序一致。
    const entries = [...this.tabs.entries()];
    entries.sort((a, b) => Number(b[1].pinned === true) - Number(a[1].pinned === true));
    this.tabs.clear();
    for (const [key, value] of entries) this.tabs.set(key, value);
    this.emit();
  }

  move(id: string, toIndex: number): void {
    if (!this.tabs.has(id)) return;
    const entries = [...this.tabs.entries()];
    const from = entries.findIndex(([key]) => key === id);
    if (from < 0) return;
    const [moved] = entries.splice(from, 1);
    const target = Math.max(0, Math.min(entries.length, Math.round(toIndex)));
    entries.splice(target, 0, moved);
    this.tabs.clear();
    for (const [key, record] of entries) this.tabs.set(key, record);
    this.emit();
  }

  async reopenClosed(): Promise<string | null> {
    const last = this.closedStack.pop();
    if (!last) return null;
    return this.create(last.url);
  }

  /** 当前会话快照，用于退出时保存。 */
  sessionSnapshot(): {
    tabs: Array<{ url: string; title: string; groupId?: string; pinned?: boolean }>;
    activeUrl: string;
    groups: TabGroup[];
  } {
    const tabs = [...this.tabs.values()]
      .filter((record) => /^https?:/i.test(record.url))
      .map((record) => ({
        url: record.url,
        title: record.title || '',
        groupId: record.groupId,
        pinned: record.pinned === true
      }));
    const active = this.activeRecord();
    return {
      tabs,
      activeUrl: active?.url || tabs[tabs.length - 1]?.url || '',
      groups: [...this.groups.values()]
    };
  }

  private releaseView(record: TabRecord): void {
    const view = record.view;
    record.view = null;
    if (!view) return;
    try {
      this.win.contentView.removeChildView(view);
    } catch {
      // ignore
    }
    try {
      view.webContents.close();
    } catch {
      // ignore
    }
  }

  // 后台标签闲置后释放渲染进程；正在出声的标签不回收（后台听视频）。
  private suspendIdle(): void {
    const now = Date.now();
    for (const [id, record] of this.tabs) {
      if (id === this.activeId || record.suspended || !record.view) continue;
      if (now - record.lastActiveAt < this.suspendAfterMs) continue;

      const wc = record.view.webContents;
      try {
        if (!wc.isDestroyed() && wc.isCurrentlyAudible()) {
          record.lastActiveAt = now;
          continue;
        }
      } catch {
        // ignore
      }
      this.suspend(record);
    }
  }

  private suspend(record: TabRecord): void {
    const view = record.view;
    if (!view) return;
    try {
      if (!view.webContents.isDestroyed()) record.url = view.webContents.getURL() || record.url;
    } catch {
      // ignore
    }
    this.releaseView(record);
    record.suspended = true;
    record.loading = false;
    console.log('[tabs] suspended', record.id, record.url);
    this.emit();
  }

  navigate(input: string): void {
    const record = this.activeRecord();
    if (!record || !record.view) return;
    const url = normalizeUrl(input, searchPref());
    void record.view.webContents.loadURL(url).catch((err: Error) => {
      console.warn('[tab] navigate 失败', url, err.message);
    });
  }

  back(): void {
    const wc = this.activeRecord()?.view?.webContents;
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(): void {
    const wc = this.activeRecord()?.view?.webContents;
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(): void {
    this.activeRecord()?.view?.webContents.reload();
  }

  stop(): void {
    this.activeRecord()?.view?.webContents.stop();
  }

  zoomIn(): void {
    this.applyZoom(0.1, false);
  }

  zoomOut(): void {
    this.applyZoom(-0.1, false);
  }

  zoomReset(): void {
    this.applyZoom(0, true);
  }

  private applyZoom(delta: number, reset: boolean): void {
    const record = this.activeRecord();
    const wc = record?.view?.webContents;
    if (!record || !wc) return;
    const next = reset ? 1 : wc.getZoomFactor() + delta;
    const zoom = Math.min(3, Math.max(0.5, Math.round(next * 100) / 100));
    wc.setZoomFactor(zoom);
    record.zoom = zoom;
    this.emit();
  }

  findInPage(query: string, options: { forward?: boolean; findNext?: boolean } = {}): void {
    const wc = this.activeRecord()?.view?.webContents;
    if (!wc) return;
    if (!query) {
      wc.stopFindInPage('clearSelection');
      return;
    }
    wc.findInPage(query, {
      forward: options.forward !== false,
      findNext: Boolean(options.findNext)
    });
  }

  stopFind(): void {
    this.activeRecord()?.view?.webContents.stopFindInPage('clearSelection');
  }

  /** 打开/折叠侧栏时退出视频全屏；否则原生页会盖住侧栏，或在窗口全屏里缩放成白屏。 */
  exitFullscreen(): void {
    const record = this.activeRecord();
    if (!record?.view) return;
    const win = BrowserWindow.fromWebContents(record.view.webContents);
    void record.view.webContents
      .executeJavaScript(
        'document.fullscreenElement ? document.exitFullscreen().catch(() => null) : null'
      )
      .catch(() => undefined);
    if (win?.isFullScreen()) win.setFullScreen(false);
  }

  /** 强制重绘当前页面；全屏/侧栏切换后原生视图偶尔会留下白底。 */
  refreshActiveView(): void {
    const record = this.activeRecord();
    if (!record?.view) return;
    const apply = () => {
      try {
        if (!record.view || record.view.webContents.isDestroyed()) return;
        // 退出全屏后 view 可能还停在旧尺寸上：重新按最新 bounds 落一次，
        // 再 invalidate 让页面立刻重绘。
        record.view.setBounds(this.bounds);
        record.view.webContents.invalidate();
      } catch {
        // ignore
      }
    };
    apply();
    // 窗口从全屏退出的动画/尺寸同步比一帧慢；再补一次，避免留下白底。
    setTimeout(apply, 160).unref?.();
  }

  setLayout(rect: LayoutRect): void {
    const hadSize = this.bounds.width > 0 && this.bounds.height > 0;
    this.bounds = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    if (!hadSize && this.bounds.width > 0) {
      console.log('[m0] layout set', JSON.stringify(this.bounds));
    }
    const view = this.activeRecord()?.view;
    if (view) {
      const changed =
        view.getBounds().width !== this.bounds.width ||
        view.getBounds().height !== this.bounds.height ||
        view.getBounds().x !== this.bounds.x ||
        view.getBounds().y !== this.bounds.y;
      view.setBounds(this.bounds);
      // 侧栏展开/收起会改变 WebContentsView 尺寸；Electron 偶尔会先显示一帧白底。
      // 主动 invalidate 让页面立刻重绘，避免用户看到“网页变白”。
      if (changed) view.webContents.invalidate();
    }
  }

  /** 退出前暂停所有标签里的音视频，避免下次恢复会话时接着响。 */
  pauseAllMedia(): void {
    for (const record of this.tabs.values()) {
      const wc = record.view?.webContents;
      if (!wc || wc.isDestroyed()) continue;
      void wc
        .executeJavaScript(
          `(() => {
            document.querySelectorAll('video, audio').forEach((element) => {
              try { element.pause(); } catch {}
            });
            return true;
          })()`
        )
        .catch(() => undefined);
    }
  }

  activeWebContents(): WebContents | null {
    return this.activeRecord()?.view?.webContents ?? null;
  }

  webContentsOf(id: string): WebContents | null {
    return this.tabs.get(id)?.view?.webContents ?? null;
  }

  // 拖拽侧栏时暂时隐藏页面，避免鼠标进入 WebContentsView 后
  // 渲染层收不到 mousemove / mouseup。
  private activeViewVisible = true;

  /** 设置保存后调用：让网页焦点下的快捷键立即用上新键位。 */
  refreshShortcuts(): void {
    this.shortcutMap = effectiveShortcuts(loadSettings().general.shortcuts);
  }

  /** 对当前标签应用播放倍速（页面里由注入脚本执行）。 */
  async setPlaybackRate(rate: number): Promise<number> {
    const record = this.activeRecord();
    const clamped = clampMediaRate(rate);
    if (!record) return clamped;
    record.rate = clamped;
    await this.pushMediaState(record);
    this.queueRateSave(record, clamped);
    this.emit();
    return clamped;
  }

  getPlaybackRate(): number {
    return this.activeRecord()?.rate ?? 1;
  }

  /** 工具栏倍速按钮：打开/收起网页里的速度面板。 */
  async toggleMediaPanel(): Promise<void> {
    const record = this.activeRecord();
    const wc = record?.view?.webContents;
    if (!record || !wc) return;
    // 先把当前状态同步进去，避免面板显示旧值。
    await this.pushMediaState(record);
    try {
      await wc.executeJavaScript(
        'window.__shiziMedia && window.__shiziMedia.togglePanel()'
      );
    } catch {
      // 页面还没加载好时忽略。
    }
  }

  /** 设置页保存后调用：重新解析每个标签的倍速并下发。 */
  refreshMediaState(): void {
    this.flushRateSave();
    const general = loadSettings().general;
    for (const record of this.tabs.values()) {
      record.rate = resolveMediaRate(general, record.url);
      void this.pushMediaState(record);
    }
    this.emit();
  }

  /** 页内面板 / 快捷键通过 CDP binding 回传的动作。 */
  private handleMediaAction(record: TabRecord, raw: string): void {
    let data: { action?: string; rate?: number; value?: boolean; commit?: boolean };
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return;
    }
    if (data.action === 'rate') {
      const next = clampMediaRate(data.rate);
      record.rate = next;
      void this.pushMediaState(record);
      if (data.commit !== false) this.queueRateSave(record, next);
      this.emit();
      return;
    }
    if (data.action === 'pitch' || data.action === 'remember') {
      const settings = loadSettings();
      if (data.action === 'pitch') {
        settings.general.mediaPreservePitch = data.value !== false;
      } else {
        settings.general.mediaRememberSite = data.value !== false;
      }
      saveSettings(settings);
      this.pushMediaStateToAll();
    }
  }

  private mediaState(record: TabRecord): {
    rate: number;
    pitch: boolean;
    remember: boolean;
    singleKey: boolean;
    widget: boolean;
    site: string;
    shortcuts: Record<string, string>;
    hints: Record<string, string>;
  } {
    const general = loadSettings().general;
    const shortcuts = effectiveShortcuts(general.shortcuts);
    return {
      rate: record.rate,
      pitch: general.mediaPreservePitch !== false,
      remember: general.mediaRememberSite !== false,
      singleKey: general.mediaSingleKey === true,
      widget: general.mediaWidget !== false,
      site: mediaSiteKey(record.url),
      shortcuts: {
        'media-faster': shortcuts['media-faster'],
        'media-slower': shortcuts['media-slower'],
        'media-reset': shortcuts['media-reset'],
        'media-panel': shortcuts['media-panel']
      },
      hints: {
        faster: shortcutDisplay(shortcuts['media-faster']),
        slower: shortcutDisplay(shortcuts['media-slower']),
        reset: shortcutDisplay(shortcuts['media-reset']),
        panel: shortcutDisplay(shortcuts['media-panel'])
      }
    };
  }

  /** 把状态下发到该标签的所有 frame（含 iframe），Set/State 保持一致。 */
  private async pushMediaState(record: TabRecord): Promise<void> {
    const wc = record.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const code =
      'window.__shiziMedia && window.__shiziMedia.setState(' +
      JSON.stringify(this.mediaState(record)) +
      ')';
    const frames: WebFrameMain[] = [];
    const seen = new Set<WebFrameMain>();
    const add = (frame: WebFrameMain | null | undefined) => {
      if (!frame || seen.has(frame)) return;
      seen.add(frame);
      frames.push(frame);
    };
    try {
      add(wc.mainFrame);
      for (const frame of wc.mainFrame.framesInSubtree) add(frame);
    } catch {
      // ignore
    }
    if (!frames.length) {
      try {
        await wc.executeJavaScript(code);
      } catch {
        // ignore
      }
      return;
    }
    await Promise.allSettled(
      frames.map((frame) => {
        try {
          return frame.executeJavaScript(code);
        } catch (error) {
          return Promise.reject(error);
        }
      })
    );
  }

  private pushMediaStateToAll(): void {
    for (const record of this.tabs.values()) void this.pushMediaState(record);
  }

  /** 导航时优先采用尚未落盘的倍速（用户改完立刻刷新也不回退）。 */
  private resolveRateFor(url: string): number {
    const pending = this.pendingRateSave;
    const general = loadSettings().general;
    const site = mediaSiteKey(url);
    if (pending) {
      if (pending.site && pending.site === site) return pending.rate;
      if (!pending.site && !site) return pending.rate;
      if (general.mediaRememberSite === false) return pending.rate;
    }
    return resolveMediaRate(general, url);
  }

  /** 倍速写入设置：按站点记忆或更新全局默认值。 */
  private queueRateSave(record: TabRecord, rate: number): void {
    this.pendingRateSave = { site: mediaSiteKey(record.url), rate };
    if (this.rateSaveTimer) return;
    this.rateSaveTimer = setTimeout(() => this.flushRateSave(), 350);
    this.rateSaveTimer.unref?.();
  }

  private flushRateSave(): void {
    if (this.rateSaveTimer) {
      clearTimeout(this.rateSaveTimer);
      this.rateSaveTimer = null;
    }
    const pending = this.pendingRateSave;
    this.pendingRateSave = null;
    if (!pending) return;
    const settings = loadSettings();
    if (pending.site && settings.general.mediaRememberSite !== false) {
      settings.general.mediaSiteRates = sanitizeMediaSiteRates({
        ...settings.general.mediaSiteRates,
        [pending.site]: pending.rate
      });
    } else {
      // 非 http(s) 页面（起始页/about:blank）没有站点可记，直接当默认倍速。
      settings.general.mediaRate = pending.rate;
    }
    saveSettings(settings);
  }

  // 网页视图是否可见由多个来源共同决定（页面/浮层、拖动、关闭确认框）。
  // 以前每个来源都直接 setVisible(true/false)，后到的调用会覆盖前一个：
  // 关掉关闭框时页面还没恢复、或者关闭框刚弹出就被其它来源重新显示出来。
  // 现在按来源登记，只有所有来源都允许时才显示。
  private hiddenReasons = new Set<string>();

  /** 按来源隐藏/恢复网页视图；reason 相同的重复调用是幂等的。 */
  setViewHidden(reason: string, hidden: boolean): void {
    if (hidden) this.hiddenReasons.add(reason);
    else this.hiddenReasons.delete(reason);
    this.applyViewVisibility();
  }

  setActiveViewVisible(visible: boolean): void {
    this.setViewHidden('ui', !visible);
  }

  private applyViewVisibility(): void {
    const visible = this.hiddenReasons.size === 0;
    this.activeViewVisible = visible;
    const record = this.activeRecord();
    try {
      record?.view?.setVisible(visible);
      if (visible && record?.view) {
        record.view.setBounds(this.bounds);
        record.view.webContents.invalidate();
      }
    } catch {
      // ignore
    }
  }

  getActiveViewState(): { visible: boolean; bounds: unknown } {
    return { visible: this.activeViewVisible, bounds: this.activeRecord()?.view?.getBounds() };
  }

  async captureActiveView(): Promise<string | null> {
    const record = this.activeRecord();
    if (!record?.view) return null;
    try {
      const image = await record.view.webContents.capturePage();
      return image.isEmpty() ? null : image.toDataURL();
    } catch {
      return null;
    }
  }

  /** 标签悬停预览：优先实时抓当前标签，后台标签用切走前缓存的缩略图。 */
  async previewOf(id: string): Promise<{ dataUrl: string; title: string; url: string } | null> {
    const record = this.tabs.get(id);
    if (!record) return null;
    if (id === this.activeId && record.view && !record.suspended) {
      await this.capturePreview(record);
    }
    const shot = this.previewShots.get(id);
    if (!shot) return null;
    return { dataUrl: shot.dataUrl, title: record.title || '新标签页', url: record.url };
  }

  private async capturePreview(record: TabRecord): Promise<void> {
    const wc = record.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      const image = await wc.capturePage();
      if (image.isEmpty()) return;
      const resized = image.resize({ width: 360 });
      const encoded = resized.toJPEG(78).toString('base64');
      this.previewShots.delete(record.id);
      this.previewShots.set(record.id, {
        dataUrl: `data:image/jpeg;base64,${encoded}`,
        at: Date.now()
      });
      // 只保留最近活跃的一批，避免长期占用内存。
      while (this.previewShots.size > 40) {
        const oldest = this.previewShots.keys().next().value;
        if (!oldest) break;
        this.previewShots.delete(oldest);
      }
    } catch {
      // 页面还没画出第一帧时忽略。
    }
  }

  list(): TabInfo[] {
    return [...this.tabs.values()]
      .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true))
      .map((record) => {
      const wc = record.view?.webContents;
      let canGoBack = false;
      let canGoForward = false;
      if (wc) {
        try {
          canGoBack = wc.navigationHistory.canGoBack();
          canGoForward = wc.navigationHistory.canGoForward();
        } catch {
          // ignore
        }
      }
      return {
        id: record.id,
        title: record.title || '新标签页',
        url: record.url,
        loading: record.loading,
        active: record.id === this.activeId,
        canGoBack,
        canGoForward,
        favicon: record.favicon,
        suspended: record.suspended,
        zoom: record.zoom || 1,
        playbackRate: record.rate,
        pinned: record.pinned === true,
        groupId: record.groupId,
        audible: (() => {
          try {
            return record.view && !record.suspended
              ? record.view.webContents.isCurrentlyAudible()
              : record.audible === true;
          } catch {
            return record.audible === true;
          }
        })(),
        muted: record.muted === true
      };
    });
  }

  dispose(): void {
    this.flushRateSave();
    if (this.suspendTimer) clearInterval(this.suspendTimer);
    this.suspendTimer = null;
    if (this.audioTimer) clearInterval(this.audioTimer);
    this.audioTimer = null;
    for (const record of this.tabs.values()) {
      this.releaseView(record);
    }
    this.tabs.clear();
    this.previewShots.clear();
    this.activeId = null;
  }

  private activeRecord(): TabRecord | null {
    if (!this.activeId) return null;
    return this.tabs.get(this.activeId) ?? null;
  }

  private emit(): void {
    this.onChanged(this.list());
  }
}
