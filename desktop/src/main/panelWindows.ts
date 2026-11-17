import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import type { DetachedPanelInfo } from '../shared/panelWindows';
import {
  PANEL_WINDOW_DEFAULT,
  PANEL_WINDOW_LIMIT,
  PANEL_WINDOW_MIN,
  panelTitleOf
} from '../shared/panelWindows';
import type { Result } from '../shared/types';

/**
 * 独立面板窗口。
 *
 * 任意侧栏面板（含插件面板）都可以拆成独立窗口；窗口无边框、可拖动、可置顶，
 * 位置与尺寸写进 userData/panel-windows.json，下次启动按原样恢复。
 * 同一个面板只允许一个独立窗口，重复打开时聚焦已有窗口。
 */

interface Entry {
  info: DetachedPanelInfo;
  win: BrowserWindow;
}

const entries = new Map<string, Entry>();
let host: BrowserWindow | null = null;
/** 退出时先落盘再关窗；关闭事件不能再把列表写空。 */
let shuttingDown = false;

function storeFile(): string {
  return path.join(app.getPath('userData'), 'panel-windows.json');
}

function readStore(): DetachedPanelInfo[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as { windows?: unknown };
    if (!Array.isArray(raw.windows)) return [];
    return (raw.windows as Partial<DetachedPanelInfo>[])
      .filter(
        (item): item is DetachedPanelInfo =>
          Boolean(item) &&
          typeof item.section === 'string' &&
          item.section.length > 0 &&
          item.section.length < 200
      )
      .slice(0, PANEL_WINDOW_LIMIT)
      .map((item) => ({
        section: String(item.section),
        title: String(item.title || panelTitleOf(String(item.section))).slice(0, 60),
        x: Number(item.x) || 0,
        y: Number(item.y) || 0,
        width: Math.max(PANEL_WINDOW_MIN.width, Number(item.width) || PANEL_WINDOW_DEFAULT.width),
        height: Math.max(PANEL_WINDOW_MIN.height, Number(item.height) || PANEL_WINDOW_DEFAULT.height),
        alwaysOnTop: item.alwaysOnTop === true
      }));
  } catch {
    return [];
  }
}

function writeStore(): void {
  try {
    const windows = [...entries.values()].map((entry) => entry.info);
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify({ version: 1, windows }, null, 2), 'utf8');
  } catch {
    // 位置保存失败不影响窗口本身
  }
}

function background(): string {
  const dark =
    nativeTheme.themeSource === 'dark' ||
    (nativeTheme.themeSource === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#141416' : '#f6f6f3';
}

function clampBounds(info: DetachedPanelInfo): DetachedPanelInfo {
  const width = Math.max(PANEL_WINDOW_MIN.width, Math.round(info.width));
  const height = Math.max(PANEL_WINDOW_MIN.height, Math.round(info.height));
  const display = screen.getDisplayMatching({
    x: Math.round(info.x),
    y: Math.round(info.y),
    width,
    height
  });
  const area = display.workArea;
  const x = Math.min(Math.max(Math.round(info.x), area.x), area.x + area.width - width);
  const y = Math.min(Math.max(Math.round(info.y), area.y), area.y + area.height - height);
  return { ...info, width, height, x, y };
}

function defaultBounds(): { x: number; y: number; width: number; height: number } {
  const base = host && !host.isDestroyed() ? host.getBounds() : null;
  const area = base
    ? screen.getDisplayMatching(base).workArea
    : screen.getPrimaryDisplay().workArea;
  const offset = (entries.size % 6) * 28;
  const x = base ? Math.min(base.x + base.width + 16, area.x + area.width - PANEL_WINDOW_DEFAULT.width) : area.x + 80;
  const y = base ? Math.max(area.y, base.y + offset) : area.y + 80;
  return { x, y, ...PANEL_WINDOW_DEFAULT };
}

function loadContent(win: BrowserWindow, info: DetachedPanelInfo): void {
  const query = { window: 'panel', section: info.section, title: info.title };
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    const url = new URL(rendererUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  }
}

function createWindow(info: DetachedPanelInfo): BrowserWindow {
  const bounds = clampBounds(info);
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: PANEL_WINDOW_MIN.width,
    minHeight: PANEL_WINDOW_MIN.height,
    frame: false,
    show: false,
    backgroundColor: background(),
    autoHideMenuBar: true,
    alwaysOnTop: bounds.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  const entry: Entry = { info: bounds, win };
  entries.set(bounds.section, entry);

  let saveTimer: NodeJS.Timeout | null = null;
  const persistSoon = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const rect = win.getBounds();
      entry.info = { ...entry.info, ...rect };
      writeStore();
    }, 300);
    saveTimer.unref?.();
  };

  win.on('move', persistSoon);
  win.on('resize', persistSoon);
  win.on('closed', () => {
    if (saveTimer) clearTimeout(saveTimer);
    entries.delete(bounds.section);
    if (!shuttingDown) writeStore();
  });
  win.once('ready-to-show', () => {
    win.show();
    if (bounds.alwaysOnTop) win.setAlwaysOnTop(true);
  });

  loadContent(win, bounds);
  writeStore();
  return win;
}

export function initPanelWindows(mainWindow: BrowserWindow): void {
  host = mainWindow;
  shuttingDown = false;
  for (const info of readStore()) {
    if (entries.has(info.section)) continue;
    createWindow(info);
  }
}

export function openPanelWindow(
  section: string,
  title?: string,
  options?: { width?: number; height?: number; alwaysOnTop?: boolean }
): Result<DetachedPanelInfo> {
  try {
    const key = String(section || '').trim();
    if (!key || key.length > 200) throw new Error('缺少面板标识');
    const existing = entries.get(key);
    if (existing) {
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show();
      existing.win.focus();
      return { ok: true, data: existing.info };
    }
    if (entries.size >= PANEL_WINDOW_LIMIT) throw new Error(`最多同时打开 ${PANEL_WINDOW_LIMIT} 个独立面板`);
    const info = clampBounds({
      section: key,
      title: String(title || panelTitleOf(key)).slice(0, 60),
      ...defaultBounds(),
      width: Math.max(PANEL_WINDOW_MIN.width, Math.round(options?.width || PANEL_WINDOW_DEFAULT.width)),
      height: Math.max(PANEL_WINDOW_MIN.height, Math.round(options?.height || PANEL_WINDOW_DEFAULT.height)),
      alwaysOnTop: options?.alwaysOnTop === true
    });
    createWindow(info);
    return { ok: true, data: info };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message || String(error) };
  }
}

export function closePanelWindow(section: string): Result<boolean> {
  const entry = entries.get(String(section || ''));
  if (!entry) return { ok: false, error: '这个面板没有独立窗口' };
  entry.win.close();
  return { ok: true, data: true };
}

export function listPanelWindows(): DetachedPanelInfo[] {
  return [...entries.values()].map((entry) => entry.info);
}

export function setPanelAlwaysOnTop(section: string, alwaysOnTop: boolean): Result<boolean> {
  const entry = entries.get(String(section || ''));
  if (!entry) return { ok: false, error: '这个面板没有独立窗口' };
  entry.win.setAlwaysOnTop(alwaysOnTop === true);
  entry.info = { ...entry.info, alwaysOnTop: alwaysOnTop === true };
  writeStore();
  return { ok: true, data: true };
}

/** 退出前把内存里的位置落盘；窗口本身由 Electron 统一关闭。 */
export function disposePanelWindows(): void {
  shuttingDown = true;
  writeStore();
  host = null;
}
