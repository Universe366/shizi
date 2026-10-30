import { ipcMain } from 'electron';
import type { Result } from '../../shared/types';
import { loadSettings } from '../settings';
import { generateImage, type ImageGenResult } from '../imageGen';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

export function registerImageIpc(): void {
  ipcMain.handle(
    'image:generate',
    async (_event, prompt: string): Promise<Result<ImageGenResult>> => {
      try {
        return ok(await generateImage(String(prompt || ''), loadSettings()));
      } catch (error) {
        return failure(error);
      }
    }
  );
}
