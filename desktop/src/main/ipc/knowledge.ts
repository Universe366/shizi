import { ipcMain } from 'electron';
import type { KbHit, KbProgress, KbStatus, Result } from '../../shared/types';
import { askKnowledge, indexKnowledge, kbStatus, searchKnowledge } from '../library/knowledge';

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
    async (_event, question: string): Promise<Result<KbHit[]>> => {
      try {
        return ok(await searchKnowledge(String(question || '')));
      } catch (error) {
        return failure<KbHit[]>(error);
      }
    }
  );

  ipcMain.handle(
    'kb:ask',
    async (
      _event,
      question: string
    ): Promise<Result<{ text: string; hits: KbHit[] }>> => {
      try {
        return ok(await askKnowledge(String(question || '')));
      } catch (error) {
        return failure<{ text: string; hits: KbHit[] }>(error);
      }
    }
  );
}
