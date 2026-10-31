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
      // 统一指向真实 track id：旧版本可能把 url 写成 library://pending-…，直接用它取正文会失败。
      url: 'library://track/' + row.id,
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
    // 页面脚本偶尔拿不到 bvid（SPA 刚切页/插件未注入），从 URL 里补一次。
    const bvid =
      info.bvid || (/BV[0-9A-Za-z]{10}/.exec(String(info.url || ''))?.[0] ?? '');
    const cid = Number(info.cid) || 0;
    const exact = database.prepare('SELECT id FROM videos WHERE uid = ?').get(uidOf(info)) as
      | { id?: number }
      | undefined;
    if (exact?.id) {
      const tracks = tracksOf(exact.id);
      if (tracks.length) return tracks;
    }

    // 旧版本可能按 cid=0 存过：这条记录本身「cid 未知」，可以兜底。
    if (bvid || info.epId) {
      const legacyUid = bvid ? `v:${bvid}:0` : `e:${info.epId}:0`;
      const legacy = database.prepare('SELECT id FROM videos WHERE uid = ?').get(legacyUid) as
        | { id?: number }
        | undefined;
      if (legacy?.id) {
        const tracks = tracksOf(legacy.id);
        if (tracks.length) return tracks;
      }
    }

    // 只有当前页面拿不到 cid 时，才允许按 bvid 猜同稿件的记录；
    // cid 已知时必须精确匹配，否则 P2 会显示 P1 的转写。
    if (!cid && (bvid || info.epId)) {
      const siblings = database
        .prepare(
          'SELECT id FROM videos WHERE (bvid = ? OR ep_id = ?) AND id != ? ORDER BY updated_at DESC LIMIT 6'
        )
        .all(bvid, Number(info.epId) || 0, Number(exact?.id) || 0) as Array<{
        id?: number;
      }>;
      for (const row of siblings) {
        if (!row.id) continue;
        const tracks = tracksOf(row.id);
        if (tracks.length) return tracks;
      }
    }

    // 老库的 bvid 字段可能为空，但 URL 里有 BV 号；同样只在 cid 未知时按 URL 猜。
    if (!cid && bvid) {
      const byBvUrl = database
        .prepare(
          'SELECT id FROM videos WHERE url LIKE ? AND (cid IS NULL OR cid = 0) ORDER BY updated_at DESC LIMIT 1'
        )
        .get(`%${bvid}%`) as { id?: number } | undefined;
      if (byBvUrl?.id) {
        const tracks = tracksOf(byBvUrl.id);
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
