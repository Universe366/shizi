/**
 * 页面媒体请求嗅探：记录每个 webContents 最近一次音视频请求。
 *
 * 抖音等站点用 MSE 播放，<video>.currentSrc 是 blob；performance 有时只覆盖主框架，
 * 用 session.webRequest 兜底记录真实的 CDN 请求，转写时优先直接下载。
 */
interface MediaEntry {
  audio?: string;
  video?: string;
  at: number;
}

const entries = new Map<number, MediaEntry>();
const MAX_ENTRIES = 80;
const TTL_MS = 30 * 60 * 1000;

export function noteMediaRequest(webContentsId: number, url: string): void {
  if (!webContentsId || !/^https?:\/\//i.test(url || '')) return;
  const isAudio = /media-audio|audio-und|mime_type=audio/i.test(url);
  // HLS/DASH 清单不能直接当文件下载，交给 yt-dlp；这里只收完整 mp4/m4a。
  const isVideo =
    !/\.m3u8|\.mpd/i.test(url) &&
    /media-video|mime_type=video|\.mp4|\.m4a/i.test(url);
  if (!isAudio && !isVideo) return;
  const entry = entries.get(webContentsId) || { at: 0 };
  if (isAudio) entry.audio = url;
  else entry.video = url;
  entry.at = Date.now();
  entries.set(webContentsId, entry);
  if (entries.size > MAX_ENTRIES) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) entries.delete(oldest[0]);
  }
}

/** 优先音频直链；没有就退回视频直链。 */
export function mediaUrlFor(webContentsId: number): string {
  const entry = entries.get(webContentsId);
  if (!entry) return '';
  if (Date.now() - entry.at > TTL_MS) return '';
  return entry.audio || entry.video || '';
}

export function clearMediaFor(webContentsId: number): void {
  entries.delete(webContentsId);
}
