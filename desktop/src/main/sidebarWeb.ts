import { BrowserWindow, Menu, WebContentsView, clipboard, nativeTheme, session } from 'electron';
import type { Rectangle, WebContents } from 'electron';
import { setZoomTarget } from './zoomTarget';
import { loadSettings, saveSettings } from './settings';
import { mediaSiteKey } from '../shared/media';
import { applyPageDarkMode } from './pageTheme';
import type { SidebarPage } from '../shared/types';

/** 所有侧栏网页共用一个独立分区：登录态与普通标签页隔离。 */
export const SIDEBAR_WEB_PARTITION = 'persist:sidebar-web';
/** 同时最多保留几个“醒着”的页面；其余销毁，切回时重新加载。 */
const AWAKE_LIMIT = 3;
/** 不活跃超过这个时间就销毁，释放进程内存。 */
const SLEEP_MS = 30 * 60 * 1000;

interface SidebarWebEntry {
  id: string;
  url: string;
  view: WebContentsView;
  bounds: Rectangle;
  attached: boolean;
  lastActive: number;
  zoom: number;
  error?: string;
  sleepTimer?: ReturnType<typeof setTimeout>;
}

const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'media',
  'clipboard-sanitized-write',
  'clipboard-read'
]);

/**
 * 侧栏网页：每个页面一个 WebContentsView，同一时间只挂一个到窗口上。
 * - 切走只 detach，网页还活着（30 分钟内切回不重新加载）；
 * - 超过 30 分钟或同时醒着超过 3 个，销毁最久没用的那个。
 */
export class SidebarWebManager {
  private readonly entries = new Map<string, SidebarWebEntry>();
  private activeId: string | null = null;
  private visible = true;
  private lastBounds: Rectangle | null = null;
  private pendingSiteZoomSave: { site: string; zoom: number } | null = null;
  private siteZoomSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ses = session.fromPartition(SIDEBAR_WEB_PARTITION);

  setWebDarkMode(): void {
    for (const entry of this.entries.values()) {
      const wc = entry.view.webContents;
      if (!wc.isDestroyed()) void applyPageDarkMode(wc);
    }
  }

  constructor(
    private readonly win: BrowserWindow,
    /** 侧栏网页里的 target=_blank / window.open 统一交给主窗口标签页，不再弹小窗。 */
    private readonly openInMain: (url: string) => void = () => undefined
  ) {
    // 渲染进程刷新/崩溃时，原生视图不会自己消失；先离开并计时休眠，避免残留在最上层。
    win.webContents.on('did-start-loading', () => this.deactivate());
    nativeTheme.on('updated', () => this.setWebDarkMode());
    this.ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    this.ses.setPermissionCheckHandler((_webContents, permission) =>
      ALLOWED_PERMISSIONS.has(permission)
    );
  }

  /** 显示某个页面（必要时创建视图）。 */
  activate(page: SidebarPage): void {
    if (this.win.isDestroyed()) return;
    // 不要在这里强行 visible=true：编辑弹窗打开时，浮层已经让视图让位，
    // 强行显示会让原生网页盖住弹窗。可见性由浮层 hook / setVisible 控制。
    // 先让上一个页面的视图离开，再做容量淘汰，避免淘汰到仍挂在窗口上的视图。
    const previous = this.activeId ? this.entries.get(this.activeId) : null;
    if (previous && previous.id !== page.id) this.detach(previous);
    const entry = this.ensureEntry(page);
    if (this.activeId && this.activeId !== entry.id) {
      const old = this.entries.get(this.activeId);
      if (old && old !== previous) this.detach(old);
    }
    entry.lastActive = Date.now();
    // 渲染层的 bounds 可能先于 activate 到达：用最近一次量到的位置，避免视图停在 0 尺寸。
    if (this.lastBounds) entry.bounds = this.lastBounds;
    if (entry.zoom === 1) entry.zoom = this.siteZoomFor(entry.url);
    try {
      entry.view.webContents.setZoomFactor(entry.zoom || 1);
    } catch {
      // ignore
    }
    if (entry.sleepTimer) {
      clearTimeout(entry.sleepTimer);
      entry.sleepTimer = undefined;
    }
    this.activeId = entry.id;
    setZoomTarget('sidebar');
    this.attach(entry);
    this.emitState();
  }

  /** 离开侧栏网页：保留进程，开始计时休眠。 */
  deactivate(): void {
    if (!this.activeId) return;
    const entry = this.entries.get(this.activeId);
    this.activeId = null;
    if (!entry) return;
    this.detach(entry);
    this.scheduleSleep(entry);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!this.activeId) return;
    if (visible) setZoomTarget('sidebar');
    const entry = this.entries.get(this.activeId);
    if (!entry) return;
    if (visible) this.attach(entry);
    else this.detach(entry);
  }

  activeWebContents(): WebContents | null {
    if (!this.activeId) return null;
    const entry = this.entries.get(this.activeId);
    const wc = entry?.view.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  getZoom(): number {
    if (this.activeId) {
      const entry = this.entries.get(this.activeId);
      if (entry) return entry.zoom || 1;
    }
    return this.activeWebContents()?.getZoomFactor() ?? 1;
  }

  state(): {
    id: string;
    url: string;
    title: string;
    zoom: number;
    canBack: boolean;
    canForward: boolean;
    loading: boolean;
    error: string;
  } | null {
    const wc = this.activeWebContents();
    if (!wc || !this.activeId) return null;
    const entry = this.entries.get(this.activeId);
    return {
      id: this.activeId,
      url: wc.getURL() || entry?.url || '',
      title: wc.getTitle() || '',
      zoom: this.getZoom(),
      canBack: wc.navigationHistory.canGoBack(),
      canForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
      error: entry?.error || ''
    };
  }

  private emitState(): void {
    if (this.win.isDestroyed()) return;
    const state = this.state();
    if (state) this.win.webContents.send('sidebar-web:state', state);
  }

  zoomIn(): void {
    this.setZoom(this.getZoom() + 0.1);
  }

  zoomOut(): void {
    this.setZoom(this.getZoom() - 0.1);
  }

  zoomReset(): void {
    this.setZoom(1);
  }

  private siteZoomFor(url: string): number {
    const key = mediaSiteKey(url);
    if (!key) return 1;
    const zoom = Number(loadSettings().general.siteZoom?.[key]);
    return Number.isFinite(zoom) && zoom >= 0.5 && zoom <= 3 ? zoom : 1;
  }

  private queueSiteZoomSave(url: string, zoom: number): void {
    const key = mediaSiteKey(url);
    if (!key) return;
    this.pendingSiteZoomSave = { site: key, zoom };
    if (this.siteZoomSaveTimer) clearTimeout(this.siteZoomSaveTimer);
    this.siteZoomSaveTimer = setTimeout(() => {
      const pending = this.pendingSiteZoomSave;
      this.pendingSiteZoomSave = null;
      if (!pending) return;
      const settings = loadSettings();
      settings.general.siteZoom = {
        ...(settings.general.siteZoom || {}),
        [pending.site]: pending.zoom
      };
      saveSettings(settings);
    }, 450);
  }

  setZoom(value: number): void {
    const wc = this.activeWebContents();
    if (!wc) return;
    const entry = this.activeId ? this.entries.get(this.activeId) : null;
    const zoom = Math.min(3, Math.max(0.5, Math.round(Number(value) * 100) / 100));
    wc.setZoomFactor(zoom);
    if (entry) {
      entry.zoom = zoom;
      this.queueSiteZoomSave(entry.url, zoom);
    }
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('page:zoom-changed', { target: 'sidebar', zoom });
    }
    this.emitState();
  }

  find(query: string, forward = true): void {
    const wc = this.activeWebContents();
    const text = String(query || '').trim();
    if (!wc || !text) return;
    wc.findInPage(text, { forward, findNext: true });
  }

  stopFind(): void {
    this.activeWebContents()?.stopFindInPage('clearSelection');
  }

  navigate(url: string): void {
    const wc = this.activeWebContents();
    if (!wc || !/^https?:\/\//i.test(url)) return;
    const entry = this.activeId ? this.entries.get(this.activeId) : null;
    if (entry) entry.url = url;
    void wc.loadURL(url).catch(() => undefined);
  }

  goBack(): void {
    const wc = this.activeWebContents();
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(): void {
    const wc = this.activeWebContents();
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  /** 重新加载当前侧栏网页（卡住/登录跳转时用）。 */
  reloadActive(): void {
    if (!this.activeId) return;
    const entry = this.entries.get(this.activeId);
    try {
      entry?.view.webContents.reload();
    } catch {
      // 视图正在销毁时忽略
    }
  }

  setBounds(rect: Rectangle): void {
    const bounds: Rectangle = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    // 0 尺寸（窗口最小化、布局过渡）不代表要隐藏；可见性只由 activate/浮层控制。
    if (bounds.width === 0 || bounds.height === 0) return;
    this.lastBounds = bounds;
    if (!this.activeId) return;
    const entry = this.entries.get(this.activeId);
    if (!entry) return;
    entry.bounds = bounds;
    if (this.visible) this.attach(entry);
    else if (entry.attached) entry.view.setBounds(bounds);
  }

  /** 清登录态：保留视图重新加载，避免清完后侧栏空白。 */
  async clearData(): Promise<void> {
    await this.ses.clearStorageData();
    await this.ses.clearCache();
    await this.ses.clearAuthCache().catch(() => undefined);
    for (const entry of this.entries.values()) {
      try {
        entry.view.webContents.reload();
      } catch {
        // 视图正在销毁时忽略
      }
    }
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.destroy(id);
  }

  private ensureEntry(page: SidebarPage): SidebarWebEntry {
    const existing = this.entries.get(page.id);
    if (existing) {
      if (existing.url !== page.url) {
        existing.url = page.url;
        void existing.view.webContents.loadURL(page.url).catch(() => undefined);
      }
      return existing;
    }

    this.evictIfNeeded(page.id);
    const view = new WebContentsView({
      webPreferences: {
        partition: SIDEBAR_WEB_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    wc.on('focus', () => setZoomTarget('sidebar'));
    wc.on('did-finish-load', () => {
      const entry = this.entries.get(page.id);
      if (!entry) return;
      entry.error = '';
      try {
        wc.setZoomFactor(entry.zoom || 1);
      } catch {
        // ignore
      }
      void applyPageDarkMode(wc);
    });
    wc.on('zoom-changed', (_event, direction) => {
      if (direction === 'in') this.zoomIn();
      else this.zoomOut();
    });
    wc.on('did-navigate', () => this.emitState());
    wc.on('did-navigate-in-page', () => this.emitState());
    wc.on('page-title-updated', () => this.emitState());
    wc.on('did-start-loading', () => {
      const entry = this.entries.get(page.id);
      if (entry) entry.error = '';
      this.emitState();
    });
    wc.on('did-stop-loading', () => this.emitState());
    wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      const entry = this.entries.get(page.id);
      if (entry) entry.error = description || `加载失败（${code}）`;
      this.emitState();
    });
    wc.on('found-in-page', (_event, result) => {
      if (this.win.isDestroyed()) return;
      this.win.webContents.send('sidebar-web:find-result', {
        matches: result.matches || 0,
        active: result.activeMatchOrdinal || 0
      });
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      // 之前 allow 会弹一个 520×720 的小窗；用户明确希望回主窗口。
      this.openInMain(url);
      return { action: 'deny' };
    });
    const guard = (event: { preventDefault: () => void }, url: string) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    // 侧栏网页没有地址栏：补上 Alt+←/→ 后退前进、F5/Ctrl+R 刷新。
    wc.on('context-menu', (_event, params) => {
      const menu = Menu.buildFromTemplate([
        {
          label: '后退',
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.navigationHistory.goBack()
        },
        {
          label: '前进',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward()
        },
        { label: '重新加载', click: () => wc.reload() },
        { type: 'separator' },
        { role: 'copy', enabled: Boolean(params.selectionText) },
        { role: 'paste', enabled: params.isEditable },
        { role: 'selectAll' },
        ...(params.linkURL
          ? [
              { type: 'separator' as const },
              {
                label: '在标签页打开链接',
                click: () => {
                  if (/^https?:\/\//i.test(params.linkURL)) this.openInMain(params.linkURL);
                }
              },
              { label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) }
            ]
          : [])
      ]);
      menu.popup({ window: this.win });
    });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '');
      const modifier = input.control || input.meta;
      if (key === 'F5' || (modifier && key.toLowerCase() === 'r')) {
        event.preventDefault();
        wc.reload();
        return;
      }
      if (modifier && (key === '=' || key === '+')) {
        event.preventDefault();
        this.zoomIn();
        return;
      }
      if (modifier && (key === '-' || key === '_')) {
        event.preventDefault();
        this.zoomOut();
        return;
      }
      if (modifier && key === '0') {
        event.preventDefault();
        this.zoomReset();
        return;
      }
      if (modifier && key.toLowerCase() === 'f') {
        event.preventDefault();
        this.win.webContents.send('sidebar-web:find-open');
        return;
      }
      if (!input.alt) return;
      if (key === 'Left' || key === 'ArrowLeft') {
        event.preventDefault();
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      } else if (key === 'Right' || key === 'ArrowRight') {
        event.preventDefault();
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      }
    });
    // 侧栏网页里的视频全屏同样会触发窗口全屏；退出窗口全屏，保留标题栏。
    wc.on('enter-html-full-screen', () => {
      if (this.win.isFullScreen()) this.win.setFullScreen(false);
    });
    void wc.loadURL(page.url).catch(() => undefined);

    const entry: SidebarWebEntry = {
      id: page.id,
      url: page.url,
      view,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      attached: false,
      lastActive: Date.now(),
      zoom: this.siteZoomFor(page.url)
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  private attach(entry: SidebarWebEntry): void {
    if (!this.visible || this.win.isDestroyed()) return;
    if (entry.bounds.width === 0 || entry.bounds.height === 0) return;
    if (!entry.attached) {
      this.win.contentView.addChildView(entry.view);
      entry.attached = true;
    }
    entry.view.setBounds(entry.bounds);
  }

  private detach(entry: SidebarWebEntry): void {
    if (!entry.attached) return;
    entry.attached = false;
    if (!this.win.isDestroyed()) {
      try {
        this.win.contentView.removeChildView(entry.view);
      } catch {
        // 窗口关闭时忽略
      }
    }
  }

  private scheduleSleep(entry: SidebarWebEntry): void {
    if (entry.sleepTimer) clearTimeout(entry.sleepTimer);
    entry.sleepTimer = setTimeout(() => this.destroy(entry.id), SLEEP_MS);
    entry.sleepTimer.unref?.();
  }

  private evictIfNeeded(keepId: string): void {
    if (this.entries.size < AWAKE_LIMIT) return;
    const victims = [...this.entries.values()]
      .filter((entry) => entry.id !== keepId)
      .sort((a, b) => a.lastActive - b.lastActive);
    while (this.entries.size >= AWAKE_LIMIT && victims.length) {
      const victim = victims.shift();
      if (victim) this.destroy(victim.id);
    }
  }

  private destroy(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.sleepTimer) clearTimeout(entry.sleepTimer);
    this.entries.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.detach(entry);
    try {
      entry.view.webContents.close();
    } catch {
      // ignore
    }
  }
}
