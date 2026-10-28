import { ipcMain } from 'electron';
import type { LocalEmbeddingTestResult, Result } from '../../shared/types';
import { pullOllamaEmbedding, testLocalEmbedding } from '../localEmbedding';
import { failure } from './shared';
import type { IpcContext } from './shared';

/** 本地向量服务：连通性/维度验证 + 通过本机 Ollama 拉取模型。 */
export function registerLocalModelsIpc(ctx: IpcContext): void {
  const pulls = new Map<string, AbortController>();

  ipcMain.handle(
    'local:embedding-test',
    async (
      _event,
      payload: { baseUrl?: string; model?: string; apiKey?: string }
    ): Promise<Result<LocalEmbeddingTestResult>> => {
      try {
        return {
          ok: true,
          data: await testLocalEmbedding({
            baseUrl: String(payload?.baseUrl || ''),
            model: String(payload?.model || ''),
            apiKey: payload?.apiKey ? String(payload.apiKey) : undefined
          })
        };
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
        return {
          ok: true,
          data: await pullOllamaEmbedding(
            { baseUrl: String(payload?.baseUrl || ''), model },
            (progress) => ctx.send('local:pull-progress', progress),
            controller.signal
          )
        };
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
}
