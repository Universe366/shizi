import type { WebContents } from 'electron';
import type { PageInfo } from '../shared/types';

export interface DetectedVideo {
  title: string;
  ogTitle: string;
  duration: number;
  width: number;
  height: number;
  author: string;
  /** 规范化后的视频地址（抖音用户页 + modal_id 要还原成 /video/<id>）。 */
  videoUrl?: string;
  /** 主视频是否正在播放（用于在多个 <video> 里优先选当前视频）。 */
  playing?: boolean;
}

/** 找当前页面“主视频”：可见、面积最大、时长 > 5s，忽略广告小窗。 */
export const VIDEO_PROBE_SCRIPT = `(() => {
  const videos = Array.from(document.querySelectorAll('video'));
  let best = null;
  let bestScore = -1;
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80) continue;
    const duration = Number(video.duration) || 0;
    if (duration > 0 && duration < 5) continue;
    const playing = !video.paused && !video.ended;
    // 合集/弹窗里常有上一个视频的 video 留在 DOM 里；正在播放的优先。
    const score = rect.width * rect.height * (playing ? 3 : 1);
    if (score > bestScore) {
      best = video;
      bestScore = score;
    }
  }
  if (!best) return null;
  const pick = (selector) => {
    const element = document.querySelector(selector);
    return element ? String(element.getAttribute('content') || '') : '';
  };
  const host = location.hostname.startsWith('www.') ? location.hostname.slice(4) : location.hostname;
  let videoUrl = '';
  if (host === 'douyin.com') {
    const modal = new URLSearchParams(location.search).get('modal_id') || '';
    const fromPath = (location.pathname.split('/video/')[1] || '').split('/')[0] || '';
    const id = /^[0-9]+$/.test(modal) ? modal : fromPath;
    if (id) videoUrl = 'https://www.douyin.com/video/' + id;
  }
  return {
    title: String(document.title || ''),
    ogTitle: pick('meta[property="og:title"]') || pick('meta[name="twitter:title"]'),
    duration: Number(best.duration) || 0,
    width: Math.round(best.getBoundingClientRect().width),
    height: Math.round(best.getBoundingClientRect().height),
    author: pick('meta[name="author"]') || pick('meta[property="og:site_name"]'),
    videoUrl,
    playing: !best.paused && !best.ended
  };
})()`;

export async function probePageVideo(wc: WebContents): Promise<DetectedVideo | null> {
  try {
    const data = (await wc.executeJavaScript(VIDEO_PROBE_SCRIPT, true)) as DetectedVideo | null;
    if (!data) return null;
    return {
      title: String(data.title || ''),
      ogTitle: String(data.ogTitle || ''),
      duration: Number(data.duration) || 0,
      width: Number(data.width) || 0,
      height: Number(data.height) || 0,
      author: String(data.author || ''),
      videoUrl: String(data.videoUrl || ''),
      playing: data.playing === true
    };
  } catch {
    return null;
  }
}

export function isBilibiliUrl(url: string): boolean {
  try {
    return /(^|\.)bilibili\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s*[-_|]\s*(抖音|快手|西瓜视频|今日头条|哔哩哔哩|bilibili).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** 不探测页面时也能得到规范视频地址（抖音 modal_id → /video/<id>）。 */
export function canonicalVideoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (/(^|\.)douyin\.com$/i.test(parsed.hostname)) {
      const modal = parsed.searchParams.get('modal_id') || '';
      const fromPath = (parsed.pathname.split('/video/')[1] || '').split('/')[0] || '';
      const id = /^[0-9]+$/.test(modal) ? modal : fromPath;
      if (id) return `https://www.douyin.com/video/${id}`;
    }
    return url;
  } catch {
    return url;
  }
}

/** 通用网页视频的 PageInfo：身份用页面 URL，字幕/转写走资料库。 */
export function webVideoInfo(url: string, video: DetectedVideo | null): PageInfo {
  const title = cleanTitle(video?.ogTitle || video?.title || '') || '网页视频';
  // 抖音用户页通过 modal_id 播放视频；身份与 yt-dlp 都需要 /video/<id>。
  const canonical =
    video?.videoUrl && /^https?:\/\//i.test(video.videoUrl)
      ? video.videoUrl
      : canonicalVideoUrl(url);
  return {
    kind: 'web',
    bvid: null,
    aid: null,
    cid: null,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title,
    owner: video?.author || '',
    desc: '',
    duration: Number(video?.duration) || 0,
    url: canonical,
    signature: `web:${canonical}`
  };
}
