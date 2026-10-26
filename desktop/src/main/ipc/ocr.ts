import { ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import { loadSettings } from '../settings';
import { ocrAvailable, ocrDataUrlWithSettings, ocrFile } from '../ocr';

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
    async (
      _event,
      payload: OcrPayload
    ): Promise<Result<{ text: string; ms: number; engine?: 'system' | 'paddle' }>> => {
      try {
        const settings = loadSettings();
        const lang = String(payload?.lang || '').trim();
        if (lang) settings.ocr.lang = lang;
        if (payload?.path) {
          const result = await ocrFile(String(payload.path), settings.ocr.lang);
          return ok({ ...result, engine: 'system' as const });
        }
        if (payload?.dataUrl) {
          return ok(await ocrDataUrlWithSettings(String(payload.dataUrl), settings));
        }
        throw new Error('缺少图片');
      } catch (error) {
        return failure(error);
      }
    }
  );

  ipcMain.handle('ocr:status', (): Result<{ available: boolean }> => {
    return ok({ available: ocrAvailable() });
  });
}
