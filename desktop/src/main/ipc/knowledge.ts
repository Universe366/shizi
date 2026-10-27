import { ipcMain } from 'electron';
import type { KbDocument, KbHit, KbProgress, KbStatus, Result } from '../../shared/types';
import {
  askKnowledge,
  indexKnowledge,
  kbDocuments,
  kbStatus,
  searchKnowledge
} from '../library/knowledge';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

export function registerKnowledgeIpc(): void {
  ipcMain.handle('kb:status', (): Result<KbStatus> => {
    try {
      return ok(kbStatus());
    } catch (error) {
      return failure<KbStatus>(error);
    }
  });

  ipcMain.handle('kb:documents', (): Result<KbDocument[]> => {
    try {
      return ok(kbDocuments());
    } catch (error) {
      return failure<KbDocument[]>(error);
    }
  });

  ipcMain.handle('kb:index', async (event): Promise<Result<KbStatus>> => {
    try {
      const sender = event.sender;
      const send = (progress: KbProgress) => {
        if (!sender.isDestroyed()) sender.send('kb:progress', progress);
      };
      return ok(await indexKnowledge(send));
    } catch (error) {
      return failure<KbStatus>(error);
    }
  });

  ipcMain.handle(
    'kb:search',
    async (
      _event,
      payload: string | { question?: string; videoId?: number }
    ): Promise<Result<KbHit[]>> => {
      try {
        const question = String(typeof payload === 'string' ? payload : payload?.question || '');
        const videoId =
          typeof payload === 'string' ? undefined : Number(payload?.videoId) || undefined;
        return ok(await searchKnowledge(question, 8, videoId));
      } catch (error) {
        return failure<KbHit[]>(error);
      }
    }
  );

  ipcMain.handle(
    'kb:ask',
    async (
      _event,
      payload: string | { question?: string; videoId?: number }
    ): Promise<Result<{ text: string; hits: KbHit[] }>> => {
      try {
        const question = String(typeof payload === 'string' ? payload : payload?.question || '');
        const videoId =
          typeof payload === 'string' ? undefined : Number(payload?.videoId) || undefined;
        return ok(await askKnowledge(question, videoId));
      } catch (error) {
        return failure<{ text: string; hits: KbHit[] }>(error);
      }
    }
  );
}
