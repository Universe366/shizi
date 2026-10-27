import { app, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  KbChunk,
  KbDocument,
  KbHit,
  KbLearningStatus,
  KbProgress,
  KbStatus,
  Result
} from '../../shared/types';
import {
  askKnowledge,
  collectionVideoIds,
  indexKnowledge,
  kbChunks,
  kbDocuments,
  kbStatus,
  searchKnowledge,
  setKbStatus,
  type KbScope
} from '../library/knowledge';
import { buildKnowledgeExport, type KnowledgeExportFormat } from '../library/knowledgeExport';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

interface ScopedPayload {
  question?: string;
  videoId?: number;
  collectionId?: number;
}

function parseScoped(payload: string | ScopedPayload): { question: string; scope?: KbScope } {
  if (typeof payload === 'string') return { question: String(payload || '') };
  const videoId = Number(payload?.videoId) || undefined;
  const collectionId = Number(payload?.collectionId) || undefined;
  return {
    question: String(payload?.question || ''),
    scope: videoId ? { videoId } : collectionId ? { collectionId } : undefined
  };
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

  ipcMain.handle('kb:chunks', (_event, videoId: number): Result<KbChunk[]> => {
    try {
      return ok(kbChunks(Number(videoId) || 0));
    } catch (error) {
      return failure<KbChunk[]>(error);
    }
  });

  ipcMain.handle(
    'kb:status-set',
    (_event, payload: { videoId?: number; status?: KbLearningStatus }): Result<KbLearningStatus> => {
      try {
        return ok(setKbStatus(Number(payload?.videoId) || 0, payload?.status || 'new'));
      } catch (error) {
        return failure<KbLearningStatus>(error);
      }
    }
  );

  ipcMain.handle('kb:collection-videos', (_event, collectionId: number): Result<number[]> => {
    try {
      return ok(collectionVideoIds(Number(collectionId) || 0));
    } catch (error) {
      return failure<number[]>(error);
    }
  });

  ipcMain.handle(
    'kb:export',
    async (_event, format: KnowledgeExportFormat): Promise<Result<string | null>> => {
      try {
        const built = buildKnowledgeExport(format === 'json' ? 'json' : 'markdown');
        const picked = await dialog.showSaveDialog({
          title: '导出知识库',
          defaultPath: path.join(app.getPath('documents'), built.filename),
          filters:
            format === 'json'
              ? [{ name: 'JSON', extensions: ['json'] }]
              : [{ name: 'Markdown', extensions: ['md'] }]
        });
        if (picked.canceled || !picked.filePath) return ok(null);
        fs.writeFileSync(picked.filePath, built.content, 'utf8');
        return ok(picked.filePath);
      } catch (error) {
        return failure<string | null>(error);
      }
    }
  );

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
    async (_event, payload: string | ScopedPayload): Promise<Result<KbHit[]>> => {
      try {
        const { question, scope } = parseScoped(payload);
        return ok(await searchKnowledge(question, 8, scope));
      } catch (error) {
        return failure<KbHit[]>(error);
      }
    }
  );

  ipcMain.handle(
    'kb:ask',
    async (
      _event,
      payload: string | ScopedPayload
    ): Promise<Result<{ text: string; hits: KbHit[] }>> => {
      try {
        const { question, scope } = parseScoped(payload);
        return ok(await askKnowledge(question, scope));
      } catch (error) {
        return failure<{ text: string; hits: KbHit[] }>(error);
      }
    }
  );
}
