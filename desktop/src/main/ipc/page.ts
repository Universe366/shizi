import { ipcMain } from 'electron';
import type {
  CollectionResolveResult,
  PageInfo,
  Result,
  SubtitleBundle,
  SubtitleTrack,
  TrackBody
} from '../../shared/types';
import {
  getPageInfo,
  getSubtitles,
  getTime,
  getTrackBody,
  seek,
  triggerSubtitleMenu
} from '../page';
import { pageContextSummary, readPageContext } from '../pageContext';
import { resolveBilibiliCollection } from '../biliCollection';
import { applyCorrectionToLines } from '../correction';
import { loadSettings } from '../settings';
import { listSavedTracks } from '../library/savedTracks';
import { failure, type IpcContext } from './shared';
import { compressDataUrl } from '../imageData';

/** 当前页面（正文 / 视频信息 / 字幕 / 播放进度）相关 IPC。 */
export function registerPageIpc(ctx: IpcContext): void {
  ipcMain.handle('page:document', async () => {
    try {
      const context = await readPageContext(ctx.tabs.activeWebContents(), 200000);
      if (!context || !context.text.trim()) {
        return { ok: false as const, error: '当前页面没有可提取的正文' };
      }
      return {
        ok: true as const,
        data: { title: context.title, url: context.url, text: context.text }
      };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('page:context', async () => {
    try {
      const context = await readPageContext(ctx.tabs.activeWebContents());
      return { ok: true as const, data: pageContextSummary(context) };
    } catch (error) {
      return failure(error);
    }
  });

  // 桌宠的即时场景：只取选中文字，不抽整页正文（大页面抽正文又慢又没必要）。
  ipcMain.handle('page:selection', async () => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return { ok: false as const, error: '没有打开的页面' };
    try {
      const raw = await wc.executeJavaScript(
        `(() => ({
          title: document.title || '',
          url: location.href,
          selection: String(window.getSelection()?.toString() || '').trim().slice(0, 4000)
        }))()`
      );
      return {
        ok: true as const,
        data: {
          title: String(raw?.title || ''),
          url: String(raw?.url || ''),
          selection: String(raw?.selection || '').slice(0, 4000)
        }
      };
    } catch (error) {
      return failure(error);
    }
  });

  // 桌宠「看屏幕」：截当前标签页（只截视图区域，不含应用外壳）。
  ipcMain.handle('page:capture', async () => {
    try {
      const dataUrl = await ctx.tabs.captureActiveView();
      if (!dataUrl) {
        // 起始页 / 设置页打开时网页视图是隐藏的，Chromium 截不到画面，直接说清楚怎么处理。
        const visible = ctx.tabs.getActiveViewState().visible;
        return {
          ok: false as const,
          error: visible
            ? '页面还没渲染出画面，稍等一下再试'
            : '主窗口当前没有显示网页（在起始页或设置里），先打开一个网页再截图'
        };
      }
      const compressed = compressDataUrl(dataUrl);
      return { ok: true as const, data: { dataUrl: compressed?.dataUrl || dataUrl } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('page:info', async (_event, tabId?: string): Promise<Result<PageInfo>> => {
    const wc = (tabId && ctx.tabs.webContentsOf(String(tabId))) || ctx.tabs.activeWebContents();
    if (!wc) return { ok: false, error: '没有打开的页面' };
    try {
      const info = await getPageInfo(wc);
      console.log('[m2] info', info.bvid, info.title, `duration=${info.duration}`);
      return { ok: true, data: info };
    } catch (error) {
      console.warn('[m2] info failed:', (error as Error).message);
      return failure<PageInfo>(error);
    }
  });

  ipcMain.handle(
    'source:resolve-collection',
    async (_event, input: string): Promise<Result<CollectionResolveResult>> => {
      try {
        return { ok: true, data: await resolveBilibiliCollection(String(input || '')) };
      } catch (error) {
        return failure<CollectionResolveResult>(error);
      }
    }
  );

  ipcMain.handle(
    'page:saved-subtitles',
    async (_event, info: PageInfo): Promise<Result<SubtitleTrack[]>> => {
      try {
        const tracks = listSavedTracks(info);
        console.log(
          '[saved-subtitles]',
          JSON.stringify({
            bvid: info?.bvid || '',
            cid: info?.cid ?? 0,
            url: String(info?.url || '').slice(0, 80),
            tracks: tracks.length
          })
        );
        return { ok: true, data: tracks };
      } catch (error) {
        return failure<SubtitleTrack[]>(error);
      }
    }
  );

  ipcMain.handle(
    'page:subtitles',
    async (_event, expectSignature?: string, tabId?: string): Promise<Result<SubtitleBundle>> => {
      const wc = (tabId && ctx.tabs.webContentsOf(String(tabId))) || ctx.tabs.activeWebContents();
      if (!wc) return { ok: false, error: '没有打开的页面' };
      try {
        // B 站 SPA 在切页/恢复会话时可能销毁旧 render frame；
        // 固定到发起请求的 tab 并在 frame disposed 时重试一次，避免“视频明明有字幕却取不到”。
        let bundle: SubtitleBundle | null = null;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            bundle = await getSubtitles(wc, String(expectSignature || '') || undefined);
            lastError = null;
            break;
          } catch (error) {
            lastError = error as Error;
            if (!/disposed|WebFrameMain|render frame/i.test(lastError.message)) throw error;
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
          }
        }
        if (!bundle) throw lastError || new Error('读取字幕失败');
        console.log(
          '[m2] subtitles',
          `tracks=${bundle.tracks.length}`,
          `needLogin=${bundle.needLogin}`,
          `sources=${bundle.sources.join(',')}`
        );
        console.log(
          '[m2] tracks',
          bundle.tracks
            .map((track) => `${track.lan}/${track.lanDoc}#${track.url.slice(-10)}`)
            .join(' ')
        );
        return { ok: true, data: bundle };
      } catch (error) {
        console.warn('[m2] subtitles failed:', (error as Error).message);
        return failure<SubtitleBundle>(error);
      }
    }
  );

  ipcMain.handle('page:trigger-subtitle', async (): Promise<Result<boolean>> => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return { ok: false, error: '没有打开的页面' };
    try {
      await triggerSubtitleMenu(wc);
      return { ok: true, data: true };
    } catch (error) {
      return failure<boolean>(error);
    }
  });

  ipcMain.handle('page:track-body', async (_event, url: string): Promise<Result<TrackBody>> => {
    try {
      const body = await getTrackBody(url);
      const bodyCorrected = {
        ...body,
        lines: applyCorrectionToLines(body.lines, loadSettings())
      };
      console.log('[m2] track body', `lines=${bodyCorrected.lines.length}`, url.slice(0, 90));
      if (bodyCorrected.lines.length) {
        const first = bodyCorrected.lines[0];
        const last = bodyCorrected.lines[bodyCorrected.lines.length - 1];
        console.log(
          '[m2] track range',
          `start=${first.start}`,
          `end=${last.end}`,
          JSON.stringify({ first: first.text, last: last.text })
        );
      }
      return { ok: true, data: bodyCorrected };
    } catch (error) {
      console.warn('[m2] track body failed:', (error as Error).message);
      return failure<TrackBody>(error);
    }
  });

  ipcMain.handle(
    'page:time',
    async (): Promise<Result<{ currentTime: number; duration: number }>> => {
      const wc = ctx.tabs.activeWebContents();
      if (!wc) return { ok: false, error: '没有打开的页面' };
      try {
        return { ok: true, data: await getTime(wc) };
      } catch (error) {
        return failure<{ currentTime: number; duration: number }>(error);
      }
    }
  );

  ipcMain.handle('page:seek', async (_event, time: number): Promise<void> => {
    const wc = ctx.tabs.activeWebContents();
    if (!wc) return;
    try {
      await seek(wc, time);
    } catch (error) {
      console.warn('[m2] seek failed:', (error as Error).message);
    }
  });
}
