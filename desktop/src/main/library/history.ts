import type { DatabaseSync } from 'node:sqlite';
import { requireDb, toNumber } from './db';
import type {
  Bookmark,
  BookmarkFolder,
  HistoryEntry,
  LibraryHistoryItem,
  LibraryTranscriptionItem
} from '../../shared/types';

/** 历史记录、转录记录、浏览历史与书签。 */
export function listHistory(limit = 100): LibraryHistoryItem[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT s.id, s.video_id, v.bvid, v.cid, v.title, v.owner, v.url, s.model, s.content_md, s.updated_at
       FROM summaries s JOIN videos v ON v.id = s.video_id
       ORDER BY s.updated_at DESC
       LIMIT ?`
    )
    .all(Math.min(500, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    videoId: Number(row.video_id),
    bvid: row.bvid ? String(row.bvid) : null,
    cid: row.cid == null ? null : Number(row.cid),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    url: String(row.url || ''),
    model: String(row.model || ''),
    content: String(row.content_md || ''),
    updatedAt: toNumber(row.updated_at)
  }));
}

export function deleteHistoryItem(id: number): boolean {
  const database = requireDb();
  const row = database.prepare('SELECT video_id FROM summaries WHERE id = ?').get(Number(id)) as
    { video_id: number } | undefined;
  if (row) {
    // 删除总结时把版本一起清掉，否则「历史版本」还能把已删内容恢复回来。
    database.prepare('DELETE FROM summary_versions WHERE video_id = ?').run(Number(row.video_id));
  }
  const result = database.prepare('DELETE FROM summaries WHERE id = ?').run(Number(id));
  return Number(result.changes) > 0;
}

export function clearHistory(): number {
  const database = requireDb();
  database.prepare('DELETE FROM summary_versions').run();
  const result = database.prepare('DELETE FROM summaries').run();
  return Number(result.changes) || 0;
}

export function listTranscriptions(limit = 200): LibraryTranscriptionItem[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT v.id, v.bvid, v.title, v.owner, v.url, v.updated_at,
              COUNT(t.id) AS track_count,
              COALESCE(SUM(t.line_count), 0) AS line_count,
              COALESCE(MAX(t.lan_doc), '') AS lan_doc
       FROM videos v JOIN tracks t ON t.video_id = v.id
       GROUP BY v.id
       ORDER BY v.updated_at DESC
       LIMIT ?`
    )
    .all(Math.min(500, Math.max(1, Math.round(limit)))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    videoId: Number(row.id),
    bvid: row.bvid ? String(row.bvid) : null,
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    url: String(row.url || ''),
    trackCount: Number(row.track_count) || 0,
    lineCount: Number(row.line_count) || 0,
    updatedAt: toNumber(row.updated_at),
    lanDoc: String(row.lan_doc || '')
  }));
}

/* ---------- 后台任务（任务中心） ---------- */

const HISTORY_LIMIT = 5000;

/** 记录一次网页访问；60 秒内同一 URL 只更新标题/时间，避免 SPA 刷出几十条。 */
export function recordHistory(input: {
  url: string;
  title?: string;
  favicon?: string | null;
}): void {
  const url = String(input?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return;
  const database = requireDb();
  const now = Date.now();
  const title = String(input.title || '').slice(0, 300);
  const favicon = input.favicon ? String(input.favicon) : null;
  const recent = database
    .prepare(
      'SELECT id, title, visited_at FROM history WHERE url = ? ORDER BY visited_at DESC LIMIT 1'
    )
    .get(url) as { id: number; title: string; visited_at: number } | undefined;

  if (recent && now - Number(recent.visited_at) < 60_000) {
    database
      .prepare(
        'UPDATE history SET visited_at = ?, title = ?, favicon = COALESCE(?, favicon) WHERE id = ?'
      )
      .run(now, title || recent.title || '', favicon, recent.id);
  } else {
    database
      .prepare('INSERT INTO history (url, title, favicon, visited_at) VALUES (?, ?, ?, ?)')
      .run(url, title, favicon, now);
    database
      .prepare(
        'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY visited_at DESC LIMIT ?)'
      )
      .run(HISTORY_LIMIT);
  }
}

export function listBrowseHistory(query = '', limit = 200): HistoryEntry[] {
  const database = requireDb();
  const text = String(query || '').trim();
  const capped = Math.min(500, Math.max(1, Math.round(limit)));
  const rows = (
    text
      ? database
          .prepare(
            `SELECT id, url, title, favicon, visited_at FROM history
             WHERE url LIKE ? OR title LIKE ?
             ORDER BY visited_at DESC LIMIT ?`
          )
          .all(`%${text}%`, `%${text}%`, capped)
      : database
          .prepare(
            'SELECT id, url, title, favicon, visited_at FROM history ORDER BY visited_at DESC LIMIT ?'
          )
          .all(capped)
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: toNumber(row.id),
    url: String(row.url || ''),
    title: String(row.title || ''),
    favicon: row.favicon == null ? null : String(row.favicon),
    visitedAt: toNumber(row.visited_at)
  }));
}

export function clearBrowseHistory(): number {
  const database = requireDb();
  return toNumber(database.prepare('DELETE FROM history').run().changes);
}

export function deleteBrowseHistoryEntry(id: number): boolean {
  const database = requireDb();
  return toNumber(database.prepare('DELETE FROM history WHERE id = ?').run(Number(id)).changes) > 0;
}

/** 站点标识：host 去掉 www.，用于「删除此站点」。 */
function hostOf(url: string): string {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 删除同站点（忽略 www.）的全部浏览记录。 */
export function deleteBrowseHistorySite(sampleUrl: string): number {
  const host = hostOf(sampleUrl);
  if (!host) return 0;
  const database = requireDb();
  const rows = database.prepare('SELECT id, url FROM history').all() as Array<{
    id: number;
    url: string;
  }>;
  const ids = rows.filter((row) => hostOf(String(row.url)) === host).map((row) => row.id);
  if (!ids.length) return 0;
  const statement = database.prepare('DELETE FROM history WHERE id = ?');
  let removed = 0;
  for (const id of ids) removed += toNumber(statement.run(id).changes) || 0;
  return removed;
}

/** 按时间范围清理：since 之后（含）的记录。 */
export function clearBrowseHistorySince(since: number): number {
  const database = requireDb();
  const cutoff = Math.max(0, Math.round(Number(since) || 0));
  return toNumber(database.prepare('DELETE FROM history WHERE visited_at >= ?').run(cutoff).changes) || 0;
}

/* ---------- 书签：书签栏 + 文件夹 ---------- */

export interface BookmarkInput {
  url: string;
  title?: string;
  favicon?: string | null;
  folder?: string;
}

/** 文件夹名统一清洗：去空白、压空格、限长；'' 保留给书签栏。 */
export function normalizeFolderName(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
}

function rowToBookmark(row: Record<string, unknown>): Bookmark {
  return {
    id: toNumber(row.id),
    url: String(row.url || ''),
    title: String(row.title || ''),
    favicon: row.favicon == null ? null : String(row.favicon),
    folder: String(row.folder || ''),
    createdAt: toNumber(row.created_at)
  };
}

function ensureFolder(database: DatabaseSync, name: string): void {
  if (!name) return;
  database
    .prepare('INSERT OR IGNORE INTO bookmark_folders (name, created_at) VALUES (?, ?)')
    .run(name, Date.now());
}

export function listBookmarks(): Bookmark[] {
  const database = requireDb();
  const rows = database
    .prepare(
      'SELECT id, url, title, favicon, folder, created_at FROM bookmarks ORDER BY folder, created_at DESC'
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToBookmark);
}

export function isBookmarked(url: string): boolean {
  const database = requireDb();
  return Boolean(database.prepare('SELECT id FROM bookmarks WHERE url = ?').get(String(url || '')));
}

/** 新增书签；同一 URL 已存在时更新标题与文件夹。 */
export function saveBookmark(input: BookmarkInput): Bookmark {
  const database = requireDb();
  const url = String(input?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('只能收藏网页地址');
  const folder = normalizeFolderName(input.folder || '');
  const title = String(input.title || url).trim().slice(0, 300) || url;
  const favicon = input.favicon ? String(input.favicon) : null;
  const existing = database.prepare('SELECT id FROM bookmarks WHERE url = ?').get(url) as
    { id: number } | undefined;
  if (existing) {
    database
      .prepare('UPDATE bookmarks SET title = ?, folder = ?, favicon = COALESCE(?, favicon) WHERE id = ?')
      .run(title, folder, favicon, existing.id);
    const row = database
      .prepare('SELECT id, url, title, favicon, folder, created_at FROM bookmarks WHERE id = ?')
      .get(existing.id);
    return rowToBookmark(row as Record<string, unknown>);
  }
  ensureFolder(database, folder);
  database
    .prepare('INSERT INTO bookmarks (url, title, favicon, folder, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(url, title, favicon, folder, Date.now());
  const row = database
    .prepare('SELECT id, url, title, favicon, folder, created_at FROM bookmarks WHERE url = ?')
    .get(url);
  return rowToBookmark(row as Record<string, unknown>);
}

export function updateBookmark(input: { url: string; title?: string; folder?: string }): boolean {
  const database = requireDb();
  const url = String(input?.url || '').trim();
  const updates: string[] = [];
  const values: Array<string | number> = [];
  if (input.title !== undefined) {
    updates.push('title = ?');
    values.push(String(input.title).trim().slice(0, 300));
  }
  if (input.folder !== undefined) {
    const folder = normalizeFolderName(input.folder);
    ensureFolder(database, folder);
    updates.push('folder = ?');
    values.push(folder);
  }
  if (!updates.length) return isBookmarked(url);
  values.push(url);
  return toNumber(database.prepare(`UPDATE bookmarks SET ${updates.join(', ')} WHERE url = ?`).run(...values).changes) > 0;
}

export function toggleBookmark(input: { url: string; title?: string; favicon?: string | null }): {
  bookmarked: boolean;
} {
  const database = requireDb();
  const url = String(input?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('只能收藏网页地址');
  const existing = database.prepare('SELECT id FROM bookmarks WHERE url = ?').get(url) as
    { id: number } | undefined;
  if (existing) {
    database.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
    return { bookmarked: false };
  }
  database
    .prepare('INSERT INTO bookmarks (url, title, favicon, created_at) VALUES (?, ?, ?, ?)')
    .run(url, String(input.title || url).slice(0, 300), input.favicon || null, Date.now());
  return { bookmarked: true };
}

export function removeBookmark(url: string): boolean {
  const database = requireDb();
  return (
    toNumber(database.prepare('DELETE FROM bookmarks WHERE url = ?').run(String(url)).changes) > 0
  );
}

export function listBookmarkFolders(): BookmarkFolder[] {
  const database = requireDb();
  const rows = database
    .prepare(
      `SELECT f.name, f.created_at, COUNT(b.id) AS count
       FROM bookmark_folders f LEFT JOIN bookmarks b ON b.folder = f.name
       GROUP BY f.name ORDER BY f.created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: String(row.name || ''),
    createdAt: toNumber(row.created_at),
    count: toNumber(row.count)
  }));
}

export function createBookmarkFolder(raw: string): BookmarkFolder[] {
  const name = normalizeFolderName(raw);
  if (!name) throw new Error('文件夹名称不能为空');
  ensureFolder(requireDb(), name);
  return listBookmarkFolders();
}

export function renameBookmarkFolder(from: string, rawTo: string): BookmarkFolder[] {
  const database = requireDb();
  const source = normalizeFolderName(from);
  const target = normalizeFolderName(rawTo);
  if (!source) throw new Error('书签栏不能改名');
  if (!target) throw new Error('文件夹名称不能为空');
  database.prepare('UPDATE bookmark_folders SET name = ? WHERE name = ?').run(target, source);
  database.prepare('UPDATE bookmarks SET folder = ? WHERE folder = ?').run(target, source);
  return listBookmarkFolders();
}

/** 删除文件夹只取消归类，书签回到书签栏。 */
export function deleteBookmarkFolder(raw: string): BookmarkFolder[] {
  const database = requireDb();
  const name = normalizeFolderName(raw);
  if (!name) throw new Error('书签栏不能删除');
  database.prepare("UPDATE bookmarks SET folder = '' WHERE folder = ?").run(name);
  database.prepare('DELETE FROM bookmark_folders WHERE name = ?').run(name);
  return listBookmarkFolders();
}
