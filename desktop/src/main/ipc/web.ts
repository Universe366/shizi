import { ipcMain } from 'electron';
import type { Result, WebSearchDiagnostics } from '../../shared/types';
import {
  clearDocumentCache,
  clearSearchMetrics,
  documentCacheSize,
  recentSearches,
  searchStats
} from '../web';

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function registerWebIpc(): void {
  ipcMain.handle('web:metrics', (): Result<WebSearchDiagnostics> => {
    return ok({
      stats: searchStats(),
      recent: recentSearches(30),
      cacheSize: documentCacheSize()
    });
  });

  ipcMain.handle('web:metrics-clear', (): Result<number> => ok(clearSearchMetrics()));

  ipcMain.handle('web:cache-clear', (): Result<number> => ok(clearDocumentCache()));
}
