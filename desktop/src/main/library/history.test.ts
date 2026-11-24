import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSchema } from '../migrations';
import { bindLibraryDatabase, releaseLibraryDatabase } from './db';
import {
  clearBrowseHistorySince,
  createBookmarkFolder,
  deleteBookmarkFolder,
  deleteBrowseHistoryEntry,
  deleteBrowseHistorySite,
  listBookmarkFolders,
  listBookmarks,
  listBrowseHistory,
  recordHistory,
  renameBookmarkFolder,
  saveBookmark,
  updateBookmark
} from './history';

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

describe('浏览历史', () => {
  it('记录后可按标题搜索，并能单条删除', () => {
    recordHistory({ url: 'https://a.example/1', title: '页面一' });
    recordHistory({ url: 'https://b.example/2', title: '页面二' });

    const all = listBrowseHistory();
    expect(all).toHaveLength(2);
    expect(listBrowseHistory('页面一')).toHaveLength(1);

    expect(deleteBrowseHistoryEntry(all[0].id)).toBe(true);
    expect(listBrowseHistory()).toHaveLength(1);
  });

  it('按站点删除：忽略 www.，不误删其它站点', () => {
    recordHistory({ url: 'https://www.example.com/a', title: 'A' });
    recordHistory({ url: 'https://example.com/b', title: 'B' });
    recordHistory({ url: 'https://other.com/c', title: 'C' });

    expect(deleteBrowseHistorySite('https://www.example.com/a')).toBe(2);
    const left = listBrowseHistory();
    expect(left).toHaveLength(1);
    expect(left[0].url).toBe('https://other.com/c');
  });

  it('按时间范围清理只删范围内的记录', () => {
    recordHistory({ url: 'https://old.example/1', title: '旧' });
    const rows = db.prepare('SELECT id FROM history').all() as Array<{ id: number }>;
    db.prepare('UPDATE history SET visited_at = ? WHERE id = ?').run(Date.now() - 3_600_000 * 5, rows[0].id);
    recordHistory({ url: 'https://new.example/2', title: '新' });

    expect(clearBrowseHistorySince(Date.now() - 3_600_000)).toBe(1);
    const left = listBrowseHistory();
    expect(left).toHaveLength(1);
    expect(left[0].url).toBe('https://old.example/1');
  });
});

describe('书签与文件夹', () => {
  it('收藏到指定文件夹，并统计数量', () => {
    saveBookmark({ url: 'https://a.example', title: 'A', folder: '学习' });
    saveBookmark({ url: 'https://b.example', title: 'B' });

    const rows = listBookmarks();
    expect(rows.find((row) => row.url === 'https://a.example')?.folder).toBe('学习');
    expect(rows.find((row) => row.url === 'https://b.example')?.folder).toBe('');

    const folders = listBookmarkFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ name: '学习', count: 1 });
  });

  it('再次收藏同一 URL 只更新标题与文件夹，不新增记录', () => {
    saveBookmark({ url: 'https://a.example', title: '旧标题' });
    saveBookmark({ url: 'https://a.example', title: '新标题', folder: '收藏夹' });
    const rows = listBookmarks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: '新标题', folder: '收藏夹' });
  });

  it('重命名文件夹会一起移动书签', () => {
    saveBookmark({ url: 'https://a.example', title: 'A', folder: '旧名' });
    const folders = renameBookmarkFolder('旧名', '新名');
    expect(folders.map((folder) => folder.name)).toEqual(['新名']);
    expect(listBookmarks()[0].folder).toBe('新名');
  });

  it('删除文件夹只取消归类，书签回到书签栏', () => {
    saveBookmark({ url: 'https://a.example', title: 'A', folder: '临时' });
    deleteBookmarkFolder('临时');
    expect(listBookmarks()[0].folder).toBe('');
    expect(listBookmarkFolders()).toHaveLength(0);
  });

  it('updateBookmark 可以只改标题或只改文件夹', () => {
    saveBookmark({ url: 'https://a.example', title: 'A' });
    updateBookmark({ url: 'https://a.example', title: 'B' });
    expect(listBookmarks()[0]).toMatchObject({ title: 'B', folder: '' });
    createBookmarkFolder('资料');
    updateBookmark({ url: 'https://a.example', folder: '资料' });
    expect(listBookmarks()[0]).toMatchObject({ title: 'B', folder: '资料' });
  });
});
