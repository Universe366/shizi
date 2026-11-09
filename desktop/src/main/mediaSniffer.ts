/**
 * 页面媒体请求嗅探：记录每个 webContents 最近的音视频请求（URL + 关键请求头）。
 *
 * 抖音等站点用 MSE 播放，<video>.currentSrc 是 blob；performance 有时只覆盖主框架，
 * 用 session.webRequest 兜底记录真实的 CDN 请求，转写时优先直接下载。
 */
export interface MediaCandidate {
  url: string;
  headers: Record<string, string>;
  at: number;
  kind: 'audio' | 'video';
}

const entries = new Map<number, MediaCandidate[]>();
const MAX_ENTRIES = 80;
const MAX_PER_TAB = 12;
const TTL_MS = 30 * 60 * 1000;
const HEADER_NAMES = new Set([
  'cookie',
  'referer',
  'origin',
  'user-agent',
  'accept',
  'accept-language'
]);

function pickHeaders(headers?: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (!HEADER_NAMES.has(lower)) continue;
    out[key] = Array.isArray(value) ? value.join('; ') : String(value);
  }
  return out;
}

export function noteMediaRequest(
  webContentsId: number,
  url: string,
  headers?: Record<string, string | string[]>
): void {
  if (!webContentsId || !/^https?:\/\//i.test(url || '')) return;
  const isAudio = /media-audio|audio-und|mime_type=audio/i.test(url);
  // HLS/DASH 清单不能直接当文件下载，交给 yt-dlp；这里只收完整 mp4/m4a。
  const isVideo =
    !/\.m3u8|\.mpd/i.test(url) &&
    /media-video|mime_type=video|\.mp4|\.m4a/i.test(url);
  if (!isAudio && !isVideo) return;
  const list = entries.get(webContentsId) || [];
  const existing = list.find((item) => item.url === url);
  if (existing) {
    existing.at = Date.now();
    if (headers) existing.headers = pickHeaders(headers);
  } else {
    list.unshift({
      url,
      headers: pickHeaders(headers),
      at: Date.now(),
      kind: isAudio ? 'audio' : 'video'
    });
  }
  entries.set(webContentsId, list.slice(0, MAX_PER_TAB));
  if (entries.size > MAX_ENTRIES) {
    const oldest = [...entries.entries()].sort((a, b) => {
      const aAt = a[1][0]?.at || 0;
      const bAt = b[1][0]?.at || 0;
      return aAt - bAt;
    })[0];
    if (oldest) entries.delete(oldest[0]);
  }
}

/** 最近可用的媒体请求，音频优先；同一标签最多返回 8 条，便于逐个重试。 */
export function mediaCandidatesFor(webContentsId: number): MediaCandidate[] {
  const list = entries.get(webContentsId) || [];
  const now = Date.now();
  return list
    .filter((item) => now - item.at <= TTL_MS)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'audio' ? -1 : 1;
      return b.at - a.at;
    })
    .slice(0, 8);
}

/** 优先音频直链；没有就退回视频直链。 */
export function mediaUrlFor(webContentsId: number): string {
  return mediaCandidatesFor(webContentsId)[0]?.url || '';
}

export function clearMediaFor(webContentsId: number): void {
  entries.delete(webContentsId);
}
