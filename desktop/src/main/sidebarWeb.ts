import { BrowserWindow, WebContentsView, session } from 'electron';
import type { Rectangle } from 'electron';
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
  private readonly ses = session.fromPartition(SIDEBAR_WEB_PARTITION);

  constructor(private readonly win: BrowserWindow) {
    // 渲染进程刷新/崩溃时，原生视图不会自己消失；先藏起来，等页面重新激活。
    win.webContents.on('did-start-loading', () => this.setVisible(false));
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
    this.visible = true;
    const entry = this.ensureEntry(page);
    if (this.activeId && this.activeId !== entry.id) {
      const previous = this.entries.get(this.activeId);
      if (previous) this.detach(previous);
    }
    entry.lastActive = Date.now();
    // 渲染层的 bounds 可能先于 activate 到达：用最近一次量到的位置，避免视图停在 0 尺寸。
    if (this.lastBounds) entry.bounds = this.lastBounds;
    if (entry.sleepTimer) {
      clearTimeout(entry.sleepTimer);
      entry.sleepTimer = undefined;
    }
    this.activeId = entry.id;
    this.attach(entry);
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
    const entry = this.entries.get(this.activeId);
    if (!entry) return;
    if (visible) this.attach(entry);
    else this.detach(entry);
  }

  setBounds(rect: Rectangle): void {
    const bounds: Rectangle = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    };
    if (bounds.width === 0 || bounds.height === 0) {
      this.setVisible(false);
      return;
    }
    this.lastBounds = bounds;
    if (!this.activeId) return;
    const entry = this.entries.get(this.activeId);
    if (!entry) return;
    entry.bounds = bounds;
    if (entry.attached) entry.view.setBounds(bounds);
  }

  async clearData(): Promise<void> {
    for (const id of [...this.entries.keys()]) this.destroy(id);
    await this.ses.clearStorageData();
    await this.ses.clearCache();
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
    wc.setWindowOpenHandler(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: this.win,
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { partition: SIDEBAR_WEB_PARTITION }
        }
      };
    });
    const guard = (event: { preventDefault: () => void }, url: string) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    void wc.loadURL(page.url).catch(() => undefined);

    const entry: SidebarWebEntry = {
      id: page.id,
      url: page.url,
      view,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      attached: false,
      lastActive: Date.now()
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
