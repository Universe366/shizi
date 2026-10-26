import { dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Result, UsageEvent, UsageSummary } from '../../shared/types';
import { clearUsage, usageCsv, usageEvents, usageSummary } from '../usage';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function failure<T>(error: unknown): Result<T> {
  return { ok: false, error: (error as Error)?.message || String(error) };
}

/** 用量统计：只读汇总 + 导出 + 清空；写入由 aiClient 内部完成。 */
export function registerUsageIpc(): void {
  ipcMain.handle('usage:summary', (_event, days: unknown) => {
    try {
      return ok<UsageSummary>(usageSummary(Number(days) || 30));
    } catch (error) {
      return failure<UsageSummary>(error);
    }
  });

  ipcMain.handle('usage:events', (_event, limit: unknown) => {
    try {
      return ok<UsageEvent[]>(usageEvents(Number(limit) || 200));
    } catch (error) {
      return failure<UsageEvent[]>(error);
    }
  });

  ipcMain.handle('usage:clear', () => {
    try {
      return ok({ removed: clearUsage() });
    } catch (error) {
      return failure<{ removed: number }>(error);
    }
  });

  ipcMain.handle('usage:export', async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog({
        title: '导出用量 CSV',
        defaultPath: path.join(
          process.env.USERPROFILE || '',
          `shizi-usage-${stamp}.csv`
        ),
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (result.canceled || !result.filePath) return ok({ canceled: true });
      fs.writeFileSync(result.filePath, usageCsv(), 'utf8');
      return ok({ canceled: false, path: result.filePath });
    } catch (error) {
      return failure<{ canceled: boolean; path?: string }>(error);
    }
  });
}
