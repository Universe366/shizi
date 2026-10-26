import { ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import { ocrAvailable, ocrDataUrl, ocrFile } from '../ocr';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

export interface OcrPayload {
  dataUrl?: string;
  path?: string;
  lang?: string;
}

/** 本地 OCR：截图/图片取字，失败时渲染层可以回退到 AI 视觉。 */
export function registerOcrIpc(): void {
  ipcMain.handle(
    'ocr:recognize',
    async (_event, payload: OcrPayload): Promise<Result<{ text: string; ms: number }>> => {
      try {
        const lang = String(payload?.lang || 'auto');
        if (payload?.path) return ok(await ocrFile(String(payload.path), lang));
        if (payload?.dataUrl) return ok(await ocrDataUrl(String(payload.dataUrl), lang));
        throw new Error('缺少图片');
      } catch (error) {
        return failure<{ text: string; ms: number }>(error);
      }
    }
  );

  ipcMain.handle('ocr:status', (): Result<{ available: boolean }> => {
    return ok({ available: ocrAvailable() });
  });
}
