import { ipcMain } from 'electron';
import type { LocalEmbeddingStatus, LocalEmbeddingTestResult, Result } from '../../shared/types';
import { loadSettings } from '../settings';
import { pullOllamaEmbedding, testLocalEmbedding } from '../localEmbedding';
import {
  deleteLocalEmbedding,
  downloadLocalEmbedding,
  localEmbeddingStatus,
  testLocalEmbeddingBuiltin
} from '../localEmbeddingModel';
import { failure } from './shared';
import type { IpcContext } from './shared';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 本地向量：本机服务探测 / Ollama 拉取 / 内置 ONNX 模型的下载与推理。 */
export function registerLocalModelsIpc(ctx: IpcContext): void {
  const pulls = new Map<string, AbortController>();
  let builtinDownload: AbortController | null = null;

  ipcMain.handle(
    'local:embedding-test',
    async (
      _event,
      payload: { baseUrl?: string; model?: string; apiKey?: string }
    ): Promise<Result<LocalEmbeddingTestResult>> => {
      try {
        return ok(
          await testLocalEmbedding({
            baseUrl: String(payload?.baseUrl || ''),
            model: String(payload?.model || ''),
            apiKey: payload?.apiKey ? String(payload.apiKey) : undefined
          })
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'local:ollama-pull',
    async (
      _event,
      payload: { baseUrl?: string; model?: string }
    ): Promise<Result<{ model: string }>> => {
      const model = String(payload?.model || '').trim();
      if (pulls.has(model)) return failure(new Error('该模型正在拉取中'));
      const controller = new AbortController();
      pulls.set(model, controller);
      try {
        return ok(
          await pullOllamaEmbedding(
            { baseUrl: String(payload?.baseUrl || ''), model },
            (progress) => ctx.send('local:pull-progress', progress),
            controller.signal
          )
        );
      } catch (error) {
        return failure(error);
      } finally {
        pulls.delete(model);
      }
    }
  );

  ipcMain.on('local:pull-cancel', (_event, model: unknown) => {
    pulls.get(String(model || ''))?.abort();
  });

  ipcMain.handle('local:builtin-status', (): Result<LocalEmbeddingStatus> => {
    try {
      return ok(localEmbeddingStatus());
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('local:builtin-download', async (): Promise<Result<LocalEmbeddingStatus>> => {
    if (builtinDownload) return failure(new Error('内置向量模型正在下载中'));
    const controller = new AbortController();
    builtinDownload = controller;
    try {
      return ok(
        await downloadLocalEmbedding(
          (progress) => ctx.send('local:builtin-progress', progress),
          controller.signal
        )
      );
    } catch (error) {
      return failure(error);
    } finally {
      builtinDownload = null;
    }
  });

  ipcMain.on('local:builtin-cancel', () => {
    builtinDownload?.abort();
  });

  ipcMain.handle(
    'local:builtin-remove',
    (): Result<{ removed: boolean; status: LocalEmbeddingStatus }> => {
      try {
        const settings = loadSettings();
        if (settings.knowledge.provider === 'local') {
          return failure(new Error('知识库正在使用内置向量模型；先切换向量来源再删除'));
        }
        return ok({ removed: deleteLocalEmbedding(), status: localEmbeddingStatus() });
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle(
    'local:builtin-test',
    async (): Promise<Result<{ dimensions: number; latencyMs: number }>> => {
      try {
        return ok(await testLocalEmbeddingBuiltin());
      } catch (error) {
        return failure(error);
      }
    }
  );
}
