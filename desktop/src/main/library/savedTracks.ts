import type { PageInfo, SubtitleLine, SubtitleTrack } from '../../shared/types';
import { requireDb } from './db';
import { uidOf } from './core';

interface TrackRow {
  id: number;
  lan: string;
  lan_doc: string;
  source: string;
  is_ai: number;
  url: string;
}

function tracksOf(videoId: number): SubtitleTrack[] {
  const rows = requireDb()
    .prepare(
      'SELECT id, lan, lan_doc, source, is_ai, url FROM tracks WHERE video_id = ? ORDER BY created_at ASC'
    )
    .all(Number(videoId)) as unknown as TrackRow[];
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
}

/**
 * 已入库的本地字幕（ASR/导入）；用 library://track/<id> 作为伪轨地址。
 * 页面信息里的 cid 可能缺失或变化（转写时还没拿到 cid、旧库按 :0 存过），
 * 所以精确 uid 找不到时，会回退到同 bvid/epId 下最近一条确实有本地字幕的视频。
 */
export function listSavedTracks(info: PageInfo): SubtitleTrack[] {
  try {
    const database = requireDb();
    const exact = database.prepare('SELECT id FROM videos WHERE uid = ?').get(uidOf(info)) as
      | { id?: number }
      | undefined;
    if (exact?.id) {
      const tracks = tracksOf(exact.id);
      if (tracks.length) return tracks;
    }

    // 同 bvid/epId：优先找确实有本地字幕的那条（例如旧版本按 cid=0 存过一次）。
    if (info.bvid || info.epId) {
      const siblings = database
        .prepare(
          'SELECT id FROM videos WHERE (bvid = ? OR ep_id = ?) AND id != ? ORDER BY updated_at DESC LIMIT 6'
        )
        .all(info.bvid || '', Number(info.epId) || 0, Number(exact?.id) || 0) as Array<{
        id?: number;
      }>;
      for (const row of siblings) {
        if (!row.id) continue;
        const tracks = tracksOf(row.id);
        if (tracks.length) return tracks;
      }
    }

    // 非 B 站 / 无 bvid：按 URL 找同一页面。
    if (!exact?.id && info.url) {
      const byUrl = database
        .prepare('SELECT id FROM videos WHERE url = ? ORDER BY updated_at DESC LIMIT 1')
        .get(info.url) as { id?: number } | undefined;
      if (byUrl?.id) return tracksOf(byUrl.id);
    }
    return [];
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
