import type { ReadingItem } from '../../shared/types';
import { requireDb, toNumber } from './db';

function rowToItem(row: Record<string, unknown>): ReadingItem {
  return {
    id: toNumber(row.id),
    url: String(row.url || ''),
    title: String(row.title || ''),
    favicon: row.favicon == null ? null : String(row.favicon),
    addedAt: toNumber(row.added_at),
    readAt: row.read_at == null ? null : toNumber(row.read_at)
  };
}

/** 加入阅读清单；同一网址重复添加只刷新标题并把状态改回未读。 */
export function addToReadingList(input: {
  url: string;
  title?: string;
  favicon?: string | null;
}): ReadingItem {
  const database = requireDb();
  const url = String(input?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('只能保存网页地址');
  const title = String(input.title || url).trim().slice(0, 300) || url;
  const favicon = input.favicon ? String(input.favicon) : null;
  const sql = [
    'INSERT INTO reading_list (url, title, favicon, added_at, read_at)',
    'VALUES (?, ?, ?, ?, NULL)',
    'ON CONFLICT(url) DO UPDATE SET',
    '  title = excluded.title,',
    '  favicon = COALESCE(excluded.favicon, reading_list.favicon),',
    '  added_at = excluded.added_at,',
    '  read_at = NULL'
  ].join(' ');
  database.prepare(sql).run(url, title, favicon, Date.now());
  const row = database
    .prepare('SELECT id, url, title, favicon, added_at, read_at FROM reading_list WHERE url = ?')
    .get(url) as Record<string, unknown>;
  return rowToItem(row);
}

export function listReadingList(): ReadingItem[] {
  const database = requireDb();
  const rows = database
    .prepare(
      'SELECT id, url, title, favicon, added_at, read_at FROM reading_list ORDER BY read_at IS NOT NULL, added_at DESC'
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToItem);
}

export function removeReadingItem(id: number): boolean {
  const database = requireDb();
  return (
    toNumber(database.prepare('DELETE FROM reading_list WHERE id = ?').run(Number(id)).changes) > 0
  );
}

export function markReadingRead(id: number, read: boolean): boolean {
  const database = requireDb();
  return (
    toNumber(
      database
        .prepare('UPDATE reading_list SET read_at = ? WHERE id = ?')
        .run(read ? Date.now() : null, Number(id)).changes
    ) > 0
  );
}
