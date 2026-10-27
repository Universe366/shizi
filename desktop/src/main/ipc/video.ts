import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, dialog, ipcMain } from 'electron';
import { pathToFileURL } from 'node:url';
import type {
  OnlineDownloadOptions,
  PageInfo,
  Result,
  SubtitleLine,
  SynthesizeRequest
} from '../../shared/types';
import { createJob, finishJob, updateJob } from '../library';
import { getLibraryDetail } from '../library/videos';
import { ingestVideo } from '../library';
import { transcribeFile } from '../asr';
import { probeDuration } from '../media';
import { loadSettings } from '../settings';
import { addExportRecord } from '../library/exports';
import { synthesizeVideo } from '../synthesize';
import { downloadOnlineVideo } from '../onlineVideo';
import { dubVideo, listTtsVoices } from '../dub';
import type { IpcContext } from './shared';
import { abortControllers, failure, trackJob } from './shared';

function safeName(text: string): string {
  return String(text || '字幕成片')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60) || '字幕成片';
}

function filePathFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return '';
    let value = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
    return value;
  } catch {
    return '';
  }
}

export function registerVideoIpc(ctx: IpcContext): void {
  ipcMain.handle(
    'video:pick-local',
    async (): Promise<
      Result<{ path: string; name: string; duration: number } | { canceled: true }>
    > => {
      try {
        const picked = await dialog.showOpenDialog(ctx.win, {
          title: '选择本地音视频',
          properties: ['openFile'],
          filters: [
            {
              name: '音视频',
              extensions: ['mp4', 'mkv', 'mov', 'webm', 'flv', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg']
            }
          ]
        });
        if (picked.canceled || !picked.filePaths[0]) return { ok: true, data: { canceled: true } };
        const file = picked.filePaths[0];
        return {
          ok: true,
          data: {
            path: file,
            name: path.basename(file),
            duration: await probeDuration(file)
          }
        };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'video:transcribe-local',
    async (
      _event,
      payload: { path: string; language?: string }
    ): Promise<Result<{ requestId: string }>> => {
      try {
        const file = path.resolve(String(payload?.path || ''));
        if (!fs.existsSync(file)) return { ok: false, error: '找不到文件' };
        const requestId = randomUUID();
        const controller = new AbortController();
        abortControllers.asr.set(requestId, controller);
        trackJob(() =>
          createJob({
            id: requestId,
            type: 'local-transcribe',
            title: `本地转录 · ${path.basename(file)}`
          })
        );
        void (async () => {
          try {
            const duration = await probeDuration(file);
            const name = path.basename(file);
            const info: PageInfo = {
              kind: 'local',
              bvid: null,
              aid: null,
              cid: null,
              epId: null,
              seasonId: null,
              page: 1,
              partTitle: '',
              parts: [],
              title: name,
              owner: '本地文件',
              desc: '',
              duration,
              url: pathToFileURL(file).toString(),
              signature: `local:${file}`
            };
            const settings = loadSettings();
            if (payload.language) settings.asr.language = payload.language;
            const result = await transcribeFile(
              file,
              info,
              (_stage, percent, message) => {
                trackJob(() =>
                  updateJob(requestId, {
                    progress: Math.min(99, Math.max(0, Math.round(percent))),
                    message
                  })
                );
                ctx.send('localtrans:progress', { requestId, percent, message });
              },
              controller.signal,
              settings
            );
            trackJob(() => finishJob(requestId, 'done', null, `完成 · ${result.lines.length} 行`));
            ctx.send('localtrans:done', {
              requestId,
              lines: result.lines,
              name,
              duration,
              path: file
            });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            ctx.send('localtrans:error', { requestId, error: message });
          } finally {
            abortControllers.asr.delete(requestId);
          }
        })();
        return { ok: true, data: { requestId } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('video:transcribe-cancel', (_event, requestId: string) => {
    abortControllers.asr.get(requestId)?.abort();
  });

  ipcMain.handle(
    'video:save-local',
    async (
      _event,
      payload: { path: string; name: string; duration: number; lines: SubtitleLine[] }
    ): Promise<Result<{ videoId: number }>> => {
      try {
        const file = path.resolve(String(payload?.path || ''));
        if (!fs.existsSync(file)) return { ok: false, error: '找不到文件' };
        if (!payload.lines?.length) return { ok: false, error: '没有字幕' };
        const info: PageInfo = {
          kind: 'local',
          bvid: null,
          aid: null,
          cid: null,
          epId: null,
          seasonId: null,
          page: 1,
          partTitle: '',
          parts: [],
          title: payload.name || path.basename(file),
          owner: '本地文件',
          desc: '',
          duration: Number(payload.duration) || 0,
          url: pathToFileURL(file).toString(),
          signature: `local:${file}`
        };
        const ingested = ingestVideo({
          info,
          track: {
            lan: 'zh-CN',
            lanDoc: '中文',
            url: `local:${file}`,
            isAi: false,
            aiStatus: null,
            source: 'local'
          },
          lines: payload.lines
        });
        ctx.send('library:changed', null);
        return { ok: true, data: { videoId: ingested.videoId } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'video:synthesize',
    async (
      _event,
      payload: SynthesizeRequest
    ): Promise<Result<{ requestId: string; path: string } | { canceled: true }>> => {
      try {
        if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) {
          return { ok: false, error: '没有字幕，无法合成' };
        }
        const videoPath = path.resolve(String(payload.videoPath || ''));
        if (!fs.existsSync(videoPath)) {
          return { ok: false, error: '找不到视频文件；在线视频请先下载成本地文件' };
        }
        const hard = payload.mode !== 'soft';
        const extension = hard ? 'mp4' : 'mkv';
        const defaultPath = path.join(
          app.getPath('downloads'),
          `${safeName(payload.title)}-${hard ? '硬字幕' : '软字幕'}.${extension}`
        );
        const picked = await dialog.showSaveDialog(ctx.win, {
          title: '导出成片',
          defaultPath,
          filters: hard
            ? [{ name: 'MP4 视频', extensions: ['mp4'] }]
            : [{ name: 'MKV 视频', extensions: ['mkv'] }]
        });
        if (picked.canceled || !picked.filePath) return { ok: true, data: { canceled: true } };
        let outputPath = picked.filePath;
        if (path.resolve(outputPath) === videoPath) {
          const parsed = path.parse(outputPath);
          outputPath = path.join(parsed.dir, `${parsed.name}-字幕${parsed.ext || `.${extension}`}`);
        }

        const requestId = payload.requestId || randomUUID();
        const controller = new AbortController();
        abortControllers.synthesize.set(requestId, controller);
        trackJob(() =>
          createJob({
            id: requestId,
            type: 'synthesize',
            title: `成片 · ${payload.title || '字幕视频'}`
          })
        );

        void (async () => {
          try {
            await synthesizeVideo(
              { ...payload, videoPath },
              outputPath,
              (progress) => {
                trackJob(() =>
                  updateJob(requestId, {
                    progress: progress.percent,
                    message: progress.message
                  })
                );
                ctx.send('synthesize:progress', {
                  requestId,
                  percent: progress.percent,
                  message: progress.message
                });
              },
              controller.signal
            );
            trackJob(() => addExportRecord(outputPath, hard ? 'video-hard' : 'video-soft', payload.title || '字幕成片'));
            trackJob(() => finishJob(requestId, 'done', null, '合成完成'));
            ctx.send('synthesize:done', { requestId, path: outputPath });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            ctx.send('synthesize:error', { requestId, error: message });
          } finally {
            abortControllers.synthesize.delete(requestId);
          }
        })();

        return { ok: true, data: { requestId, path: outputPath } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'video:batch-synthesize',
    async (
      _event,
      payload: {
        ids: number[];
        mode?: 'hard' | 'soft';
        style?: SynthesizeRequest['style'];
      }
    ): Promise<Result<{ requestId: string; dir: string; total: number } | { canceled: true }>> => {
      try {
        const ids = Array.isArray(payload?.ids) ? payload.ids.map(Number).filter(Boolean) : [];
        if (!ids.length) return { ok: false, error: '没有选择条目' };
        const picked = await dialog.showOpenDialog(ctx.win, {
          title: '选择成片输出文件夹',
          properties: ['openDirectory', 'createDirectory']
        });
        if (picked.canceled || !picked.filePaths[0]) return { ok: true, data: { canceled: true } };
        const dir = picked.filePaths[0];
        const requestId = randomUUID();
        const controller = new AbortController();
        abortControllers.synthesize.set(requestId, controller);
        const hard = payload.mode !== 'soft';
        const extension = hard ? 'mp4' : 'mkv';
        trackJob(() =>
          createJob({
            id: requestId,
            type: 'batch-synthesize',
            title: `批量成片 · ${ids.length} 个`
          })
        );

        void (async () => {
          let done = 0;
          let skipped = 0;
          try {
            for (const id of ids) {
              if (controller.signal.aborted) throw new Error('已取消');
              const detail = getLibraryDetail(id);
              if (!detail?.bundle?.lines.length) {
                skipped += 1;
                continue;
              }
              const videoPath = filePathFromUrl(detail.video.url);
              if (!videoPath || !fs.existsSync(videoPath)) {
                skipped += 1;
                continue;
              }
              const outputPath = path.join(
                dir,
                `${safeName(detail.video.title)}-${hard ? '硬字幕' : '软字幕'}.${extension}`
              );
              await synthesizeVideo(
                {
                  requestId: `${requestId}:${id}`,
                  videoPath,
                  title: detail.video.title,
                  lines: detail.bundle.lines,
                  mode: hard ? 'hard' : 'soft',
                  style: payload.style as SynthesizeRequest['style']
                },
                outputPath,
                (progress) => {
                  const overall = ((done + progress.percent / 100) / ids.length) * 100;
                  trackJob(() =>
                    updateJob(requestId, {
                      progress: overall,
                      message: `${detail.video.title.slice(0, 24)} · ${progress.message}`
                    })
                  );
                },
                controller.signal
              );
              trackJob(() =>
                addExportRecord(outputPath, hard ? 'video-hard' : 'video-soft', detail.video.title)
              );
              done += 1;
              trackJob(() =>
                updateJob(requestId, {
                  progress: (done / ids.length) * 100,
                  message: `已完成 ${done} / ${ids.length}`
                })
              );
            }
            trackJob(() =>
              finishJob(
                requestId,
                'done',
                null,
                `完成 ${done} 个${skipped ? `，跳过 ${skipped} 个（无字幕/非本地视频）` : ''}`
              )
            );
            ctx.send('synthesize:done', { requestId, path: dir });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            ctx.send('synthesize:error', { requestId, error: message });
          } finally {
            abortControllers.synthesize.delete(requestId);
          }
        })();

        return { ok: true, data: { requestId, dir, total: ids.length } };
      } catch (error) {
        return failure(error);
      }
    }
  );


  ipcMain.handle('video:tts-voices', async (): Promise<Result<{ voices: string[] }>> => {
    try {
      return { ok: true, data: { voices: await listTtsVoices() } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'video:dub',
    async (
      _event,
      payload: {
        videoPath: string;
        title: string;
        lines: Array<{ start: number; end: number; text: string }>;
        voice?: string;
        mode: 'audio' | 'video';
      }
    ): Promise<Result<{ requestId: string; path: string } | { canceled: true }>> => {
      try {
        if (!payload?.lines?.length) return { ok: false, error: '没有字幕，无法配音' };
        const videoPath = path.resolve(String(payload.videoPath || ''));
        if (payload.mode === 'video' && !fs.existsSync(videoPath)) {
          return { ok: false, error: '找不到视频文件；配音视频需要本地视频' };
        }
        const extension = payload.mode === 'audio' ? 'm4a' : 'mp4';
        const picked = await dialog.showSaveDialog(ctx.win, {
          title: payload.mode === 'audio' ? '导出配音音轨' : '导出配音视频',
          defaultPath: path.join(
            app.getPath('downloads'),
            `${safeName(payload.title)}-${payload.mode === 'audio' ? '配音' : '配音视频'}.${extension}`
          ),
          filters:
            payload.mode === 'audio'
              ? [{ name: 'M4A 音频', extensions: ['m4a'] }]
              : [{ name: 'MP4 视频', extensions: ['mp4'] }]
        });
        if (picked.canceled || !picked.filePath) return { ok: true, data: { canceled: true } };
        const requestId = randomUUID();
        const controller = new AbortController();
        abortControllers.dub.set(requestId, controller);
        trackJob(() =>
          createJob({ id: requestId, type: 'dub', title: `配音 · ${payload.title || '字幕视频'}` })
        );
        void (async () => {
          try {
            await dubVideo(
              videoPath,
              payload.lines,
              picked.filePath,
              { voice: payload.voice, mode: payload.mode, title: payload.title },
              (progress, message) => {
                trackJob(() => updateJob(requestId, { progress, message }));
              },
              controller.signal
            );
            trackJob(() =>
              addExportRecord(
                picked.filePath,
                payload.mode === 'audio' ? 'dub-audio' : 'dub-video',
                payload.title || '配音'
              )
            );
            trackJob(() => finishJob(requestId, 'done', null, '配音完成'));
            ctx.send('dub:done', { requestId, path: picked.filePath });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            ctx.send('dub:error', { requestId, error: message });
          } finally {
            abortControllers.dub.delete(requestId);
          }
        })();
        return { ok: true, data: { requestId, path: picked.filePath } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('video:dub-cancel', (_event, requestId: string) => {
    abortControllers.dub.get(requestId)?.abort();
  });

  ipcMain.handle(
    'video:download',
    async (
      _event,
      payload: string | { url: string; options?: OnlineDownloadOptions }
    ): Promise<Result<{ requestId: string }>> => {
      try {
        const url = String(typeof payload === 'string' ? payload : payload?.url || '').trim();
        const options =
          typeof payload === 'string' ? {} : (payload?.options || {}) as OnlineDownloadOptions;
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: '请填写 http/https 链接' };
        const requestId = randomUUID();
        const controller = new AbortController();
        abortControllers.download.set(requestId, controller);
        trackJob(() =>
          createJob({
            id: requestId,
            type: 'online-download',
            title: '在线视频下载'
          })
        );
        void (async () => {
          try {
            const result = await downloadOnlineVideo(
              url,
              (progress, message) => {
                trackJob(() =>
                  updateJob(requestId, { progress, message })
                );
              },
              controller.signal,
              options
            );
            trackJob(() => finishJob(requestId, 'done', null, '下载完成'));
            ctx.send('download:done', { requestId, path: result.path });
          } catch (error) {
            const message = controller.signal.aborted
              ? '已取消'
              : (error as Error)?.message || String(error);
            trackJob(() =>
              finishJob(requestId, controller.signal.aborted ? 'cancelled' : 'failed', message)
            );
            ctx.send('download:error', { requestId, error: message });
          } finally {
            abortControllers.download.delete(requestId);
          }
        })();
        return { ok: true, data: { requestId } };
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('video:download-cancel', (_event, requestId: string) => {
    abortControllers.download.get(requestId)?.abort();
  });

  ipcMain.handle('video:synthesize-cancel', (_event, requestId: string) => {
    abortControllers.synthesize.get(requestId)?.abort();
  });
}
