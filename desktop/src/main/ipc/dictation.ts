import { ipcMain } from 'electron';
import { handleDictationResult } from '../dictation';

/** 全局听写：热键在 dictation.ts，渲染层识别完成后从这里回传。 */
export function registerDictationIpc(): void {
  ipcMain.on('dictation:finish', (_event, payload: { text?: string; error?: string }) => {
    void handleDictationResult(payload || {});
  });
}
