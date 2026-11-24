import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSchema } from '../migrations';
import { bindLibraryDatabase, releaseLibraryDatabase } from './db';
import { addDownload, clearDownloadsSince, listDownloads } from './downloads';

let db: DatabaseSync;

beforeEach(() => {
  releaseLibraryDatabase();
  db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY, title TEXT, url TEXT NOT NULL DEFAULT '');"
  );
  migrateSchema(db);
  bindLibraryDatabase(db, '');
});

describe('下载记录按范围清理', () => {
  it('只删范围内开始的记录，且不动文件', () => {
    const oldId = addDownload({ url: 'https://old.example/a.mp4', filename: 'a.mp4' });
    db.prepare('UPDATE downloads SET started_at = ? WHERE id = ?').run(
      Date.now() - 3_600_000 * 5,
      oldId
    );
    addDownload({ url: 'https://new.example/b.mp4', filename: 'b.mp4' });

    expect(listDownloads()).toHaveLength(2);
    expect(clearDownloadsSince(Date.now() - 3_600_000)).toBe(1);
    const left = listDownloads();
    expect(left).toHaveLength(1);
    expect(left[0].filename).toBe('a.mp4');
  });
});
