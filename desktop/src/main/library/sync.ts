import { requireDb, toNumber } from './db';

/**
 * 插件同步用的只读投影。
 *
 * 与 library.ts 的 UI 投影分开：这里不返回字幕正文（可能几百 KB），
 * 只给插件「库」列表和详情摘要；字幕按需走 /v1/library/lines。
 */
export interface SyncLibraryItem {
  /** 桌面库内部 id，插件只透传，不依赖。 */
  id: number;
  uid: string;
  bvid: string | null;
  cid: number | null;
  epId: number | null;
  title: string;
  owner: string;
  cover: string | null;
  url: string;
  kind: string;
  source: string;
  duration: number;
  createdAt: number;
  updatedAt: number;
  summaryUpdatedAt: number | null;
  summaryModel: string;
  summaryPreview: string;
  noteUpdatedAt: number | null;
  tags: string[];
  collections: string[];
  trackCount: number;
  lineCount: number;
  chars: number;
}

export interface SyncLibrarySummary {
  content: string;
  model: string;
  updatedAt: number;
}

export interface SyncLibraryNote {
  content: string;
  updatedAt: number;
}

export interface SyncLibraryTrack {
  lan: string;
  lanDoc: string;
  source: string;
  isAi: boolean;
  url: string;
  lineCount: number;
  updatedAt: number;
}

export interface SyncLibraryDetail {
  item: SyncLibraryItem;
  summary: SyncLibrarySummary | null;
  note: SyncLibraryNote | null;
  tracks: SyncLibraryTrack[];
}

const ITEM_COLUMNS = [
  'SELECT v.id, v.uid, v.bvid, v.cid, v.ep_id, v.title, v.owner, v.duration,',
  'v.cover, v.url, v.kind, v.source, v.created_at, v.updated_at,',
  '(SELECT MAX(s.updated_at) FROM summaries s WHERE s.video_id = v.id) AS summary_at,',
  '(SELECT s.model FROM summaries s WHERE s.video_id = v.id',
  'ORDER BY s.updated_at DESC LIMIT 1) AS summary_model,',
  '(SELECT substr(s.content_md, 1, 240) FROM summaries s WHERE s.video_id = v.id',
  'ORDER BY s.updated_at DESC LIMIT 1) AS summary_preview,',
  '(SELECT MAX(n.updated_at) FROM notes n WHERE n.video_id = v.id) AS note_at,',
  '(SELECT group_concat(tg.name, char(31)) FROM video_tags vt',
  'JOIN tags tg ON tg.id = vt.tag_id WHERE vt.video_id = v.id) AS tags,',
  '(SELECT group_concat(cl.name, char(30)) FROM collection_items ci',
  'JOIN collections cl ON cl.id = ci.collection_id',
  'WHERE ci.video_id = v.id) AS collections,',
  '(SELECT COUNT(*) FROM tracks t WHERE t.video_id = v.id) AS track_count,',
  '(SELECT COALESCE(SUM(t.line_count), 0) FROM tracks t WHERE t.video_id = v.id) AS line_count,',
  '(SELECT COALESCE(SUM(length(sg.text)), 0) FROM segments sg',
  'JOIN tracks t2 ON t2.id = sg.track_id WHERE t2.video_id = v.id) AS char_count',
  'FROM videos v'
].join(' ');

function splitList(raw: unknown, separator: string): string[] {
  return raw == null ? [] : String(raw).split(separator).filter(Boolean);
}

function mapItem(row: Record<string, unknown>): SyncLibraryItem {
  return {
    id: toNumber(row.id),
    uid: String(row.uid || ''),
    bvid: row.bvid == null ? null : String(row.bvid),
    cid: row.cid == null ? null : toNumber(row.cid),
    epId: row.ep_id == null ? null : toNumber(row.ep_id),
    title: String(row.title || ''),
    owner: String(row.owner || ''),
    cover: row.cover == null ? null : String(row.cover),
    url: String(row.url || ''),
    kind: String(row.kind || 'video'),
    source: String(row.source || ''),
    duration: toNumber(row.duration),
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    summaryUpdatedAt: row.summary_at == null ? null : toNumber(row.summary_at),
    summaryModel: String(row.summary_model || ''),
    summaryPreview: String(row.summary_preview || ''),
    noteUpdatedAt: row.note_at == null ? null : toNumber(row.note_at),
    tags: splitList(row.tags, String.fromCharCode(31)),
    collections: splitList(row.collections, String.fromCharCode(30)),
    trackCount: toNumber(row.track_count),
    lineCount: toNumber(row.line_count),
    chars: toNumber(row.char_count)
  };
}

export interface SyncChangeSet {
  full: boolean;
  items: SyncLibraryItem[];
  deleted: string[];
  serverTime: number;
}

/** 增量变更：since（ms）之后的视频 + 回收站里的删除（墓碑）。 */
export function librarySyncChanges(since: number): SyncChangeSet {
  const serverTime = Date.now();
  if (!Number.isFinite(since) || since <= 0) {
    return { full: true, items: [], deleted: [], serverTime };
  }
  const database = requireDb();
  const rows = database
    .prepare(ITEM_COLUMNS + ' WHERE v.updated_at > ? ORDER BY v.updated_at ASC LIMIT 300')
    .all(Math.floor(since)) as Array<Record<string, unknown>>;
  const deletedRows = database
    .prepare('SELECT uid FROM trash WHERE created_at > ? ORDER BY created_at ASC LIMIT 300')
    .all(Math.floor(since)) as Array<Record<string, unknown>>;
  return {
    full: false,
    items: rows.map(mapItem),
    deleted: deletedRows.map((row) => String(row.uid || '')).filter(Boolean),
    serverTime
  };
}

/** 库内视频总数：用于判断列表是否被 500 条上限截断。 */
export function librarySyncCount(): number {
  const database = requireDb();
  const row = database.prepare('SELECT COUNT(*) AS total FROM videos').get() as
    | { total: number }
    | undefined;
  return toNumber(row && row.total);
}

/** 库列表快照：最多 500 条，按更新时间倒序。插件用它做本地镜像。 */
export function librarySyncItems(): SyncLibraryItem[] {
  const database = requireDb();
  const rows = database
    .prepare(ITEM_COLUMNS + ' ORDER BY v.updated_at DESC LIMIT 500')
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapItem);
}

/** 单条详情（含总结/笔记/轨元数据，不含字幕正文）。找不到返回 null。 */
export function librarySyncItem(uid: string): SyncLibraryDetail | null {
  const database = requireDb();
  const row = database.prepare(ITEM_COLUMNS + ' WHERE v.uid = ?').get(String(uid || '')) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const item = mapItem(row);
  const videoId = toNumber(row.id);

  const summaryRow = database
    .prepare(
      'SELECT content_md, model, updated_at FROM summaries WHERE video_id = ? ORDER BY updated_at DESC LIMIT 1'
    )
    .get(videoId) as { content_md: string; model: string; updated_at: number } | undefined;

  const noteRow = database
    .prepare('SELECT content_md, updated_at FROM notes WHERE video_id = ?')
    .get(videoId) as { content_md: string; updated_at: number } | undefined;

  const trackRows = database
    .prepare(
      'SELECT lan, lan_doc, source, is_ai, url, line_count, updated_at FROM tracks WHERE video_id = ? ORDER BY line_count DESC, updated_at DESC'
    )
    .all(videoId) as Array<Record<string, unknown>>;

  return {
    item,
    summary: summaryRow
      ? {
          content: String(summaryRow.content_md || ''),
          model: String(summaryRow.model || ''),
          updatedAt: toNumber(summaryRow.updated_at)
        }
      : null,
    note: noteRow
      ? {
          content: String(noteRow.content_md || ''),
          updatedAt: toNumber(noteRow.updated_at)
        }
      : null,
    tracks: trackRows.map((track) => ({
      lan: String(track.lan || ''),
      lanDoc: String(track.lan_doc || track.lan || ''),
      source: String(track.source || ''),
      isAi: Boolean(track.is_ai),
      url: String(track.url || ''),
      lineCount: toNumber(track.line_count),
      updatedAt: toNumber(track.updated_at)
    }))
  };
}
