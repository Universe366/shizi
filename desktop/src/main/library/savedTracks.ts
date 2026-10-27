import type { PageInfo, SubtitleLine, SubtitleTrack } from '../../shared/types';
import { requireDb } from './db';
import { uidOf } from './core';

/** 已入库的本地字幕（ASR/导入）；用 library://track/<id> 作为伪轨地址。 */
export function listSavedTracks(info: PageInfo): SubtitleTrack[] {
  try {
    const database = requireDb();
    let video = database.prepare('SELECT id FROM videos WHERE uid = ?').get(uidOf(info)) as
      | { id?: number }
      | undefined;
    // 转写时可能还没拿到 cid（uid 以 :0 结尾），或页面刷新后 cid 短暂缺失；
    // 只有该 bvid/epId 在库里恰好对应一条视频时才回退，避免把 A 集的转写贴到 B 集。
    if (!video?.id && (info.bvid || info.epId)) {
      const rows = database
        .prepare(
          'SELECT id FROM videos WHERE bvid = ? OR ep_id = ? ORDER BY updated_at DESC LIMIT 2'
        )
        .all(info.bvid || '', Number(info.epId) || 0) as Array<{ id?: number }>;
      if (rows.length === 1) video = rows[0];
    }
    if (!video?.id) return [];
    const rows = database
      .prepare(
        'SELECT id, lan, lan_doc, source, is_ai, url FROM tracks WHERE video_id = ? ORDER BY created_at ASC'
      )
      .all(Number(video.id)) as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({
        lan: String(row.lan || ''),
        lanDoc: String(row.lan_doc || row.lan || ''),
        url: String(row.url || 'library://track/' + row.id),
        isAi: Boolean(row.is_ai),
        aiStatus: null,
        source: String(row.source || 'library')
      }))
      .filter(
        (track) =>
          track.source === 'asr' || track.source === 'import' || track.url.startsWith('library://')
      );
  } catch {
    return [];
  }
}

export function savedTrackLines(trackId: number): SubtitleLine[] {
  try {
    const rows = requireDb()
      .prepare('SELECT start_ms, end_ms, text FROM segments WHERE track_id = ? ORDER BY start_ms ASC')
      .all(Number(trackId)) as Array<{ start_ms?: number; end_ms?: number; text?: string }>;
    return rows
      .map((row) => ({
        start: Number(row.start_ms || 0) / 1000,
        end: Number(row.end_ms || 0) / 1000,
        text: String(row.text || '')
      }))
      .filter((line) => line.text.trim());
  } catch {
    return [];
  }
}

export function setTrackUrl(trackId: number, url: string): void {
  try {
    requireDb()
      .prepare('UPDATE tracks SET url = ?, updated_at = ? WHERE id = ?')
      .run(url, Date.now(), Number(trackId));
  } catch {
    // ignore
  }
}
