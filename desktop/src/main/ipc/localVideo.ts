import fs from 'node:fs';
import { dialog, ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import type { IpcContext } from './shared';
import { failure } from './shared';
import { ingestLocalFile } from '../library/videos';
import { probeDuration } from '../media';
import {
  PLAYABLE_VIDEO_EXTENSIONS,
  isPlayableVideoFile,
  localVideoTitle
} from '../localVideo';

/** 打开本地视频：选择文件 → 入库 → 用本地播放页建标签。 */
export function registerLocalVideoIpc(ctx: IpcContext): void {
  ipcMain.handle(
    'local:open',
    async (
      _event,
      input?: { path?: string }
    ): Promise<Result<{ tabId: string; title: string } | null>> => {
      try {
        let file = typeof input?.path === 'string' ? input.path.trim() : '';
        if (file) {
          if (!fs.existsSync(file)) return { ok: false, error: '文件不存在' };
        } else {
          const picked = await dialog.showOpenDialog(ctx.win, {
            title: '打开本地视频',
            properties: ['openFile'],
            filters: [{ name: '可直接播放的视频', extensions: PLAYABLE_VIDEO_EXTENSIONS }]
          });
          if (picked.canceled || !picked.filePaths[0]) return { ok: true, data: null };
          file = picked.filePaths[0];
        }
        if (!isPlayableVideoFile(file)) {
          return {
            ok: false,
            error: `这个格式无法直接播放；请换成 ${PLAYABLE_VIDEO_EXTENSIONS.join(' / ')}，或先用工作台转码`
          };
        }
        const title = localVideoTitle(file);
        const duration = await probeDuration(file).catch(() => 0);
        await ingestLocalFile({ path: file, title, duration });
        ctx.send('library:changed', null);
        const tabId = await ctx.tabs.create('', { localFile: file });
        return { ok: true, data: { tabId, title } };
      } catch (error) {
        return failure(error);
      }
    }
  );
}
