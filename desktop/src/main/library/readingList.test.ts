import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateSchema } from '../migrations';
import { bindLibraryDatabase, releaseLibraryDatabase } from './db';
import {
  addToReadingList,
  listReadingList,
  markReadingRead,
  removeReadingItem
} from './readingList';

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

describe('阅读清单', () => {
  it('添加后可按未读列出', () => {
    addToReadingList({ url: 'https://a.example/post', title: 'A 文章' });
    const rows = listReadingList();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'A 文章', readAt: null });
  });

  it('同一网址重复添加只刷新标题并恢复未读', () => {
    const first = addToReadingList({ url: 'https://a.example/post', title: '旧标题' });
    markReadingRead(first.id, true);
    addToReadingList({ url: 'https://a.example/post', title: '新标题' });

    const rows = listReadingList();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: '新标题', readAt: null });
  });

  it('已读条目排到未读后面', () => {
    const read = addToReadingList({ url: 'https://a.example/1', title: '已读' });
    addToReadingList({ url: 'https://a.example/2', title: '未读' });
    markReadingRead(read.id, true);
    const rows = listReadingList();
    expect(rows.map((row) => row.title)).toEqual(['未读', '已读']);
  });

  it('标记与移除', () => {
    const item = addToReadingList({ url: 'https://a.example/x', title: 'X' });
    expect(markReadingRead(item.id, true)).toBe(true);
    expect(listReadingList()[0].readAt).not.toBeNull();
    expect(removeReadingItem(item.id)).toBe(true);
    expect(listReadingList()).toHaveLength(0);
  });
});
