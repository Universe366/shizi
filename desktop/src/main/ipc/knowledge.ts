import { app, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  KbCard,
  KbChunk,
  KbDocument,
  KbHit,
  KbLearningStatus,
  KbProgress,
  KbQaEntry,
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
import {
  createKbCard,
  deleteKbCard,
  listKbCards,
  listKbQa,
  reviewKbCard,
  saveKbQa
} from '../library/knowledgeMemory';
import { getLibraryDetail } from '../library/videos';
import { listCollections } from '../library/collections';
import type { KbReviewGrade } from '../../shared/kbReview';

/** 把范围翻译成可读标题（写进问答历史）。 */
function describeScope(scope?: KbScope): string {
  try {
    if (scope?.videoId) return getLibraryDetail(scope.videoId).video?.title || '单篇文档';
    if (scope?.collectionId) {
      return listCollections().find((item) => item.id === scope.collectionId)?.name || '合集';
    }
  } catch {
    // ignore
  }
  return '全部文档';
}

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

  ipcMain.handle(
    'kb:history',
    (_event, payload: { videoId?: number; limit?: number } | undefined): Result<KbQaEntry[]> => {
      try {
        return ok(listKbQa({ videoId: Number(payload?.videoId) || undefined, limit: payload?.limit }));
      } catch (error) {
        return failure<KbQaEntry[]>(error);
      }
    }
  );

  ipcMain.handle(
    'kb:cards',
    (
      _event,
      payload: { dueOnly?: boolean; videoId?: number; limit?: number } | undefined
    ): Result<KbCard[]> => {
      try {
        return ok(
          listKbCards({
            dueOnly: payload?.dueOnly === true,
            videoId: Number(payload?.videoId) || undefined,
            limit: payload?.limit
          })
        );
      } catch (error) {
        return failure<KbCard[]>(error);
      }
    }
  );

  ipcMain.handle(
    'kb:card-add',
    (_event, payload: { videoId?: number; front?: string; back?: string }): Result<KbCard> => {
      try {
        return ok(
          createKbCard({
            videoId: Number(payload?.videoId) || null,
            front: String(payload?.front || ''),
            back: String(payload?.back || '')
          })
        );
      } catch (error) {
        return failure<KbCard>(error);
      }
    }
  );

  ipcMain.handle(
    'kb:card-review',
    (_event, payload: { id?: number; grade?: KbReviewGrade }): Result<KbCard> => {
      try {
        return ok(reviewKbCard(Number(payload?.id) || 0, payload?.grade || 'good'));
      } catch (error) {
        return failure<KbCard>(error);
      }
    }
  );

  ipcMain.handle('kb:card-delete', (_event, id: number): Result<boolean> => {
    try {
      return ok(deleteKbCard(Number(id) || 0));
    } catch (error) {
      return failure<boolean>(error);
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
    async (_event, payload: string | ScopedPayload): Promise<Result<KbHit[]>> => {
      try {
        const { question, scope } = parseScoped(payload);
        const hits = await searchKnowledge(question, 8, scope);
        try {
          saveKbQa({
            question,
            answer: '',
            mode: 'search',
            scopeLabel: describeScope(scope),
            hits
          });
        } catch {
          // 历史落库失败不影响检索
        }
        return ok(hits);
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
        const result = await askKnowledge(question, scope);
        try {
          saveKbQa({
            question,
            answer: result.text,
            mode: 'ask',
            scopeLabel: describeScope(scope),
            hits: result.hits
          });
        } catch {
          // 历史落库失败不影响回答
        }
        return ok(result);
      } catch (error) {
        return failure<{ text: string; hits: KbHit[] }>(error);
      }
    }
  );
}
