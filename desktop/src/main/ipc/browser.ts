import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Bookmark,
  BookmarkFolder,
  DownloadRecord,
  HistoryEntry,
  LayoutRect,
  ReadingItem,
  Result
} from '../../shared/types';
import {
  clearBrowseHistory,
  clearBrowseHistorySince,
  clearDownloads,
  clearDownloadsSince,
  createBookmarkFolder,
  deleteBookmarkFolder,
  deleteBrowseHistoryEntry,
  deleteBrowseHistorySite,
  deleteDownload,
  isBookmarked,
  listBookmarkFolders,
  listBookmarks,
  listBrowseHistory,
  listDownloads,
  addToReadingList,
  listReadingList,
  markReadingRead,
  removeReadingItem,
  removeBookmark,
  renameBookmarkFolder,
  saveBookmark,
  updateBookmark,
  updateDownload
} from '../library';
import { activeDownloadIds, controlDownload } from '../downloads';
import { seek } from '../page';
import { loadSettings, saveSettings, settingsSnapshot } from '../settings';
import { setZoomTarget } from '../zoomTarget';
import { showFindOverlay, showZoomOverlay } from '../overlayHost';
import { mediaSiteKey } from '../../shared/media';
import { failure, withStartParam, type IpcContext } from './shared';

/** 标签页 / 书签 / 下载 / 浏览历史 / 布局 相关 IPC。 */
export function registerBrowserIpc(ctx: IpcContext): void {
  ipcMain.handle('tabs:list', () => ctx.tabs.list());
  ipcMain.handle('tabs:groups', () => ctx.tabs.groupsList());
  ipcMain.handle('tab:preview', async (_event, id: string) => {
    try {
      const preview = await ctx.tabs.previewOf(String(id));
      if (!preview) return null;
      const wc = ctx.tabs.webContentsOf(String(id));
      const alive = wc && !wc.isDestroyed();
      return {
        dataUrl: preview.dataUrl,
        title: (alive && wc.getTitle()) || preview.title,
        url: (alive && wc.getURL()) || preview.url
      };
    } catch {
      return null;
    }
  });
  ipcMain.handle('group:create', (_event, name: string, color: string) =>
    ctx.tabs.createGroup(String(name || ''), (color || 'blue') as never)
  );
  ipcMain.handle('group:assign', (_event, tabId: string, groupId: string | null) => {
    ctx.tabs.assignGroup(String(tabId), groupId ? String(groupId) : null);
  });
  ipcMain.handle('group:rename', (_event, id: string, name: string) => {
    ctx.tabs.renameGroup(String(id), String(name || ''));
  });
  ipcMain.handle('group:color', (_event, id: string, color: string) => {
    ctx.tabs.setGroupColor(String(id), color as never);
  });
  ipcMain.handle('group:collapse', (_event, id: string) => {
    ctx.tabs.toggleGroupCollapsed(String(id));
  });
  ipcMain.handle('group:close', (_event, id: string) => {
    ctx.tabs.closeGroup(String(id));
  });
  ipcMain.handle('tab:new', (_event, url?: string) => ctx.tabs.create(url));

  // 独立窗口：普通 BrowserWindow（不走 WebContentsView 合成路径），
  // 用于绕开某些页面在视图里的合成卡顿。
  const detachedWindows = new Set<BrowserWindow>();
  ipcMain.handle('window:open-url', async (_event, url: string): Promise<Result<boolean>> => {
    try {
      const target = String(url || '');
      if (!/^https?:/i.test(target)) return failure('只能打开 http(s) 页面');
      const win = new BrowserWindow({
        width: 1280,
        height: 820,
        title: '拾字 · 独立窗口',
        webPreferences: {
          session: session.defaultSession,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false
        }
      });
      detachedWindows.add(win);
      win.on('closed', () => detachedWindows.delete(win));
      await win.loadURL(target);
      return { ok: true, data: true };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle('tab:set-muted', (_event, id: string, muted: boolean) => {
    ctx.tabs.setMuted(String(id), muted === true);
  });
  ipcMain.handle('tab:sleep', async (_event, id: string) => ctx.tabs.sleepTab(String(id)));
  ipcMain.handle('tab:wake', async (_event, id: string) => ctx.tabs.wakeTab(String(id)));
  ipcMain.handle('tabs:closed', () => ctx.tabs.closedTabs());
  ipcMain.handle('tabs:reopen-at', async (_event, index: number) =>
    ctx.tabs.reopenClosedAt(Number(index))
  );
  ipcMain.handle('tab:open', async (_event, url: string, start?: number) => {
    const time = Number(start);
    const safeTime = Number.isFinite(time) && time > 0 ? Math.floor(time) : 0;
    // 新标签靠 URL 的 t 参数落点；复用标签不会被重新导航，下面再补 seek。
    const target = withStartParam(String(url || ''), safeTime);
    const result = await ctx.tabs.openOrActivate(target);
    if (result.reused && result.ready && safeTime > 0) {
      const wc = ctx.tabs.webContentsOf(result.id);
      if (wc) {
        try {
          await seek(wc, safeTime);
        } catch (error) {
          console.warn('[tab] seek 失败:', (error as Error).message);
        }
      }
    }
    return result;
  });
  ipcMain.handle('media:playing', async () => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return { ok: true as const, data: false };
    try {
      const playing = await wc.executeJavaScript(
        '(() => { const v = document.querySelector("video, audio"); return Boolean(v && !v.paused && !v.ended && v.readyState > 2); })()'
      );
      return { ok: true as const, data: playing === true };
    } catch {
      return { ok: true as const, data: false };
    }
  });
  ipcMain.handle('media:toggle', async () => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return { ok: true as const, data: { playing: false } };
    try {
      const playing = await wc.executeJavaScript(
        `(() => {
          const v = document.querySelector('video, audio');
          if (!v) return false;
          if (v.paused || v.ended) {
            const started = v.play();
            if (started && typeof started.catch === 'function') started.catch(() => {});
            return true;
          }
          v.pause();
          return false;
        })()`
      );
      return { ok: true as const, data: { playing: playing === true } };
    } catch {
      return { ok: true as const, data: { playing: false } };
    }
  });
  ipcMain.handle('media:set-rate', async (_event, rate: number) => {
    return { ok: true as const, data: await ctx.tabs.setPlaybackRate(rate) };
  });
  ipcMain.handle('media:toggle-panel', async () => {
    await ctx.tabs.toggleMediaPanel();
  });
  ipcMain.handle('tab:set-visible', (_event, visible: boolean) => {
    ctx.tabs.setActiveViewVisible(visible !== false);
  });
  ipcMain.handle('tab:pin', (_event, id: string, pinned: boolean) => {
    ctx.tabs.pin(id, pinned === true);
  });
  ipcMain.handle('tab:duplicate', async (_event, id: string) => ctx.tabs.duplicate(String(id)));
  ipcMain.handle('tab:reload-tab', (_event, id: string) => {
    ctx.tabs.reloadTab(String(id));
  });
  ipcMain.on(
    'page:context-action',
    (_event, action: string, pageX?: number, pageY?: number) => {
      const wc = ctx.tabs.activeWebContents();
      if (!wc) return;
      if (action === 'back') ctx.tabs.back();
      else if (action === 'forward') ctx.tabs.forward();
      else if (action === 'reload') ctx.tabs.reload();
      else if (action === 'paste') wc.paste();
      else if (action === 'select-all') wc.selectAll();
      else if (action === 'inspect' && !app.isPackaged) {
        wc.inspectElement(Number(pageX) || 0, Number(pageY) || 0);
      }
    }
  );
  ipcMain.handle('tab:move', (_event, id: string, index: number) => {
    ctx.tabs.move(id, index);
  });
  ipcMain.handle('tab:move-many', (_event, ids: string[], index: number) => {
    ctx.tabs.moveMany(Array.isArray(ids) ? ids.map(String) : [], index);
  });
  ipcMain.handle('tab:close', (_event, id: string, nextId?: string) => {
    ctx.tabs.close(id, nextId ? String(nextId) : undefined);
  });
  ipcMain.handle('tab:activate', async (_event, id: string) => {
    await ctx.tabs.activate(id);
  });
  ipcMain.handle('tab:navigate', (_event, url: string) => {
    ctx.tabs.navigate(url);
  });
  ipcMain.handle(
    'tab:nav-history',
    (): Result<{ entries: Array<{ index: number; url: string; title: string }>; activeIndex: number }> => {
      try {
        return { ok: true, data: ctx.tabs.navigationEntries() };
      } catch (error) {
        return failure<{ entries: Array<{ index: number; url: string; title: string }>; activeIndex: number }>(
          error
        );
      }
    }
  );
  ipcMain.handle('tab:go-nav-index', (_event, index: number) => {
    ctx.tabs.goToNavigationIndex(Number(index));
  });
  ipcMain.handle('tab:back', () => {
    ctx.tabs.back();
  });
  ipcMain.handle('tab:forward', () => {
    ctx.tabs.forward();
  });
  ipcMain.handle('tab:reload', () => {
    ctx.tabs.reload();
  });
  ipcMain.handle('tab:stop', () => {
    ctx.tabs.stop();
  });
  const control = ctx.pageControl;

  ipcMain.handle('tab:zoom-in', () => control?.zoomIn());
  ipcMain.handle('tab:zoom-out', () => control?.zoomOut());
  ipcMain.handle('tab:zoom-reset', () => control?.zoomReset());
  ipcMain.handle('tab:set-zoom', (_event, value: number) => control?.setZoom(value));
  ipcMain.handle('page:set-site-dark', (_event, input: unknown) => {
    try {
      const raw = (input || {}) as { url?: unknown; disabled?: unknown };
      const host = mediaSiteKey(String(raw.url || ''));
      if (!host) return { ok: false, error: '网址无效' };
      const disabled = raw.disabled === true;
      const settings = loadSettings();
      const current = new Set(settings.general.siteDarkDisabled || []);
      if (disabled) current.add(host);
      else current.delete(host);
      settings.general.siteDarkDisabled = Array.from(current).slice(0, 300);
      saveSettings(settings);
      control?.reapplyTheme();
      ctx.send('settings:changed', settingsSnapshot());
      return { ok: true, data: { host, disabled } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'page:zoom-menu',
    async (
      _event,
      rect?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    ): Promise<Result<boolean>> => {
      if (!ctx.win || ctx.win.isDestroyed()) return failure('主窗口不可用');
      const current = control?.getZoom() ?? 1;
      const anchor =
        rect &&
        [rect.x, rect.y, rect.width, rect.height].every((value) =>
          Number.isFinite(Number(value))
        )
          ? {
              x: Number(rect.x),
              y: Number(rect.y),
              width: Number(rect.width),
              height: Number(rect.height)
            }
          : null;
      if (anchor) {
        const shown = await showZoomOverlay(ctx.win, { current, anchor });
        if (shown) return { ok: true, data: true };
      }
      const apply = (value: number) => control?.setZoom(value);
      const presets = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3];
      const menu = Menu.buildFromTemplate([
        { label: '放大', accelerator: 'CommandOrControl+=', click: () => apply(current + 0.1) },
        { label: '缩小', accelerator: 'CommandOrControl+-', click: () => apply(current - 0.1) },
        { label: '重置为 100%', click: () => apply(1) },
        { type: 'separator' },
        ...presets.map((value) => ({
          label: `${Math.round(value * 100)}%`,
          type: 'radio' as const,
          checked: Math.abs(current - value) < 0.001,
          click: () => apply(value)
        }))
      ]);
      menu.popup({ window: ctx.win });
      return { ok: true, data: true };
    }
  );

  ipcMain.handle('page:find-overlay', async (): Promise<Result<boolean>> => {
    if (!ctx.win || ctx.win.isDestroyed()) return failure('主窗口不可用');
    // Overlay 查找只针对主页面；侧栏网页有自己的查找条。
    setZoomTarget('tab');
    return { ok: true, data: await showFindOverlay(ctx.win) };
  });

  ipcMain.handle('page:zoom-get', (): Result<{ target: 'tab' | 'sidebar'; zoom: number }> => {
    return {
      ok: true,
      data: {
        target: control?.target() ?? 'tab',
        zoom: control?.getZoom() ?? 1
      }
    };
  });
  ipcMain.handle(
    'tab:find',
    (_event, query: string, options?: { forward?: boolean; findNext?: boolean }) => {
      control?.find(query, options || {});
    }
  );
  ipcMain.handle('tab:stop-find', () => {
    control?.stopFind();
  });

  ipcMain.handle('tab:print', (): Result<boolean> => {
    try {
      return { ok: true, data: ctx.tabs.printActive() };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle(
    'tab:save-pdf',
    async (): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        return { ok: true, data: await ctx.tabs.savePdfActive() };
      } catch (error) {
        return failure<{ canceled: boolean; path?: string }>(error);
      }
    }
  );
  ipcMain.handle('tab:reopen-closed', async (): Promise<string | null> => ctx.tabs.reopenClosed());

  ipcMain.handle(
    'browse-history:list',
    (_event, query?: string, limit?: number): Result<HistoryEntry[]> => {
      try {
        return { ok: true, data: listBrowseHistory(String(query || ''), Number(limit) || 100) };
      } catch (error) {
        return failure<HistoryEntry[]>(error);
      }
    }
  );

  ipcMain.handle('browse-history:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearBrowseHistory() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('bookmarks:list', (): Result<Bookmark[]> => {
    try {
      return { ok: true, data: listBookmarks() };
    } catch (error) {
      return failure<Bookmark[]>(error);
    }
  });

  ipcMain.handle('bookmarks:check', (_event, url: string): Result<{ bookmarked: boolean }> => {
    try {
      return { ok: true, data: { bookmarked: isBookmarked(String(url || '')) } };
    } catch (error) {
      return failure<{ bookmarked: boolean }>(error);
    }
  });

  ipcMain.handle('bookmarks:remove', (_event, url: string): Result<{ removed: boolean }> => {
    try {
      const removed = removeBookmark(String(url || ''));
      if (removed) ctx.send('bookmarks:changed', null);
      return { ok: true, data: { removed } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  // 收藏弹窗：新增或更新（同一 URL 覆盖标题/文件夹）。
  ipcMain.handle(
    'bookmarks:save',
    (
      _event,
      payload: { url: string; title?: string; favicon?: string | null; folder?: string }
    ): Result<Bookmark> => {
      try {
        const saved = saveBookmark(payload || { url: '' });
        ctx.send('bookmarks:changed', null);
        return { ok: true, data: saved };
      } catch (error) {
        return failure<Bookmark>(error);
      }
    }
  );

  ipcMain.handle(
    'bookmarks:update',
    (_event, payload: { url: string; title?: string; folder?: string }): Result<{ updated: boolean }> => {
      try {
        const updated = updateBookmark(payload || { url: '' });
        if (updated) ctx.send('bookmarks:changed', null);
        return { ok: true, data: { updated } };
      } catch (error) {
        return failure<{ updated: boolean }>(error);
      }
    }
  );

  ipcMain.handle(
    'bookmarks:export-html',
    async (_event, html: string): Promise<Result<{ canceled: boolean; path?: string }>> => {
      try {
        const options = {
          title: '导出书签',
          defaultPath: path.join(app.getPath('documents'), 'bookmarks.html'),
          filters: [{ name: '书签 HTML', extensions: ['html', 'htm'] }]
        };
        const result =
          ctx.win && !ctx.win.isDestroyed()
            ? await dialog.showSaveDialog(ctx.win, options)
            : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
        await fs.promises.writeFile(result.filePath, String(html || ''), 'utf8');
        return { ok: true, data: { canceled: false, path: result.filePath } };
      } catch (error) {
        return failure<{ canceled: boolean; path?: string }>(error);
      }
    }
  );

  ipcMain.handle('reading-list:list', (): Result<ReadingItem[]> => {
    try {
      return { ok: true, data: listReadingList() };
    } catch (error) {
      return failure<ReadingItem[]>(error);
    }
  });

  ipcMain.handle(
    'reading-list:add',
    (
      _event,
      payload: { url: string; title?: string; favicon?: string | null }
    ): Result<ReadingItem> => {
      try {
        return { ok: true, data: addToReadingList(payload || { url: '' }) };
      } catch (error) {
        return failure<ReadingItem>(error);
      }
    }
  );

  ipcMain.handle('reading-list:remove', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: removeReadingItem(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle(
    'reading-list:mark',
    (_event, id: number, read: boolean): Result<{ updated: boolean }> => {
      try {
        return { ok: true, data: { updated: markReadingRead(Number(id), read === true) } };
      } catch (error) {
        return failure<{ updated: boolean }>(error);
      }
    }
  );

  ipcMain.handle('bookmark-folders:list', (): Result<BookmarkFolder[]> => {
    try {
      return { ok: true, data: listBookmarkFolders() };
    } catch (error) {
      return failure<BookmarkFolder[]>(error);
    }
  });

  ipcMain.handle('bookmark-folders:create', (_event, name: string): Result<BookmarkFolder[]> => {
    try {
      const folders = createBookmarkFolder(String(name || ''));
      ctx.send('bookmarks:changed', null);
      return { ok: true, data: folders };
    } catch (error) {
      return failure<BookmarkFolder[]>(error);
    }
  });

  ipcMain.handle(
    'bookmark-folders:rename',
    (_event, from: string, to: string): Result<BookmarkFolder[]> => {
      try {
        const folders = renameBookmarkFolder(String(from || ''), String(to || ''));
        ctx.send('bookmarks:changed', null);
        return { ok: true, data: folders };
      } catch (error) {
        return failure<BookmarkFolder[]>(error);
      }
    }
  );

  ipcMain.handle('bookmark-folders:delete', (_event, name: string): Result<BookmarkFolder[]> => {
    try {
      const folders = deleteBookmarkFolder(String(name || ''));
      ctx.send('bookmarks:changed', null);
      return { ok: true, data: folders };
    } catch (error) {
      return failure<BookmarkFolder[]>(error);
    }
  });

  ipcMain.handle('browse-history:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteBrowseHistoryEntry(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('browse-history:delete-site', (_event, url: string): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: deleteBrowseHistorySite(String(url || '')) } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle(
    'browse-history:clear-range',
    (_event, since: number): Result<{ removed: number }> => {
      try {
        return { ok: true, data: { removed: clearBrowseHistorySince(Number(since) || 0) } };
      } catch (error) {
        return failure<{ removed: number }>(error);
      }
    }
  );

  ipcMain.handle('downloads:list', (): Result<DownloadRecord[]> => {
    try {
      return { ok: true, data: listDownloads() };
    } catch (error) {
      return failure<DownloadRecord[]>(error);
    }
  });

  ipcMain.handle('downloads:delete', (_event, id: number): Result<{ removed: boolean }> => {
    try {
      return { ok: true, data: { removed: deleteDownload(Number(id)) } };
    } catch (error) {
      return failure<{ removed: boolean }>(error);
    }
  });

  ipcMain.handle('downloads:clear', (): Result<{ removed: number }> => {
    try {
      return { ok: true, data: { removed: clearDownloads() } };
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle(
    'downloads:control',
    (
      _event,
      payload: { id: number; action: 'pause' | 'resume' | 'cancel' }
    ): Result<{ state: string }> => {
      try {
        const result = controlDownload(Number(payload?.id), payload?.action);
        if (!result.ok) return { ok: false, error: result.error || '下载已结束' };
        updateDownload(Number(payload.id), {
          state: result.state,
          finished: result.state === 'cancelled'
        });
        ctx.send('downloads:changed', null);
        return { ok: true, data: { state: result.state } };
      } catch (error) {
        return failure<{ state: string }>(error);
      }
    }
  );

  ipcMain.handle(
    'downloads:bulk',
    (_event, action: 'pause' | 'resume'): Result<{ changed: number }> => {
      try {
        const wanted = action === 'pause' ? 'pause' : 'resume';
        let changed = 0;
        for (const id of activeDownloadIds()) {
          const result = controlDownload(id, wanted);
          if (!result.ok) continue;
          updateDownload(id, { state: result.state });
          changed += 1;
        }
        if (changed) ctx.send('downloads:changed', null);
        return { ok: true, data: { changed } };
      } catch (error) {
        return failure<{ changed: number }>(error);
      }
    }
  );

  ipcMain.handle('downloads:reveal-folder', async (): Promise<Result<boolean>> => {
    try {
      const withPath = listDownloads(300).find((row) => row.path);
      if (withPath?.path) {
        shell.showItemInFolder(withPath.path);
        return { ok: true, data: true };
      }
      const error = await shell.openPath(app.getPath('downloads'));
      return error ? { ok: false, error } : { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  // 只清一个站点：不清别的站点，也不动全局缓存/登录。
  ipcMain.handle(
    'page:clear-site-data',
    async (_event, rawUrl: string): Promise<Result<{ origin: string }>> => {
      try {
        const url = new URL(String(rawUrl || ''));
        if (!/^https?:$/.test(url.protocol)) return failure('只能清理网页站点');
        const origin = url.origin;
        await session.defaultSession.clearStorageData({
          origin,
          storages: [
            'cookies',
            'filesystem',
            'indexdb',
            'localstorage',
            'cachestorage',
            'serviceworkers',
            'shadercache'
          ]
        });
        return { ok: true, data: { origin } };
      } catch (error) {
        return failure<{ origin: string }>(error);
      }
    }
  );

  // 按范围清理：历史/下载按时间筛选；Cookie 与缓存由 Chromium 全量清（Electron 不支持按时间清）。
  ipcMain.handle(
    'browser:clear-data-range',
    async (
      _event,
      payload: {
        since?: number;
        history?: boolean;
        downloads?: boolean;
        cookies?: boolean;
        cache?: boolean;
      }
    ): Promise<Result<{ history: number; downloads: number }>> => {
      try {
        const since = Math.max(0, Number(payload?.since) || 0);
        let history = 0;
        let downloads = 0;
        if (payload?.history) history = since ? clearBrowseHistorySince(since) : clearBrowseHistory();
        if (payload?.downloads) downloads = since ? clearDownloadsSince(since) : clearDownloads();
        if (payload?.cookies) {
          await session.defaultSession.clearStorageData({
            storages: [
              'cookies',
              'filesystem',
              'indexdb',
              'localstorage',
              'cachestorage',
              'serviceworkers',
              'shadercache'
            ]
          });
        }
        if (payload?.cache) await session.defaultSession.clearCache();
        if (downloads) ctx.send('downloads:changed', null);
        return { ok: true, data: { history, downloads } };
      } catch (error) {
        return failure<{ history: number; downloads: number }>(error);
      }
    }
  );

  ipcMain.handle('downloads:open', async (_event, id: number): Promise<Result<boolean>> => {
    try {
      const item = listDownloads(300).find((row) => row.id === Number(id));
      if (!item?.path) return { ok: false, error: '文件还没有保存到本地' };
      const error = await shell.openPath(item.path);
      return error ? { ok: false, error } : { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('downloads:reveal', (_event, id: number): Result<boolean> => {
    try {
      const item = listDownloads(300).find((row) => row.id === Number(id));
      if (!item?.path) return { ok: false, error: '文件还没有保存到本地' };
      shell.showItemInFolder(item.path);
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });
  ipcMain.on('layout:set', (_event, rect: LayoutRect) => {
    ctx.tabs.setLayout(rect);
  });
  ipcMain.on('tabs:exit-fullscreen', () => {
    ctx.tabs.exitFullscreen();
  });
  ipcMain.on('tabs:refresh-view', () => {
    ctx.tabs.refreshActiveView();
  });
}
