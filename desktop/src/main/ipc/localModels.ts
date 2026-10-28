import { ipcMain } from 'electron';
import type { LocalEmbeddingTestResult, Result } from '../../shared/types';
import { testLocalEmbedding } from '../localEmbedding';
import { failure } from './shared';

/** 本地向量服务：只做连通性/维度验证，真正索引仍走知识库的 embedding 平台。 */
export function registerLocalModelsIpc(): void {
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
}
