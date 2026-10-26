import { ipcMain } from 'electron';
import type { Result, TtsSettings } from '../../shared/types';
import { loadSettings } from '../settings';
import { listVoices, synthesizeSpeech } from '../tts';
import type { TtsResult } from '../tts';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

export function registerTtsIpc(): void {
  ipcMain.handle(
    'tts:speak',
    async (
      _event,
      payload: { text?: string; override?: TtsSettings }
    ): Promise<Result<TtsResult>> => {
      try {
        const text = String(payload?.text || '');
        const settings = loadSettings();
        const override = payload?.override;
        if (override && typeof override === 'object') {
          settings.tts = { ...settings.tts, ...override };
        }
        return ok(await synthesizeSpeech(text, settings));
      } catch (error) {
        return failure<TtsResult>(error);
      }
    }
  );

  ipcMain.handle(
    'tts:voices',
    async (): Promise<Result<{ edge: Array<{ id: string; label: string }>; sapi: string[] }>> => {
      try {
        return ok(await listVoices());
      } catch (error) {
        return failure(error);
      }
    }
  );
}
