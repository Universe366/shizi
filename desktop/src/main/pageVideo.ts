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
  /** 页面实际加载的媒体直链（优先音频），用于绕过站点签名/反爬直接下载。 */
  mediaUrl?: string;
}

/** 找当前页面“主视频”：可见、面积最大、时长 > 5s，忽略广告小窗。 */
export const VIDEO_PROBE_SCRIPT = `(() => {
  const videos = Array.from(document.querySelectorAll('video'));
  let best = null;
  let bestArea = 0;
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80) continue;
    const duration = Number(video.duration) || 0;
    if (duration > 0 && duration < 5) continue;
    if (video.readyState < 1 && duration === 0) continue;
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = video;
      bestArea = area;
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
  const resources = performance.getEntriesByType('resource').map((item) => item.name);
  // 取最新的媒体请求：同一标签切换视频后，旧视频的地址还留在 performance 里。
  const audio = resources.filter((item) => /media-audio|audio-und|mime_type=audio/i.test(item)).pop();
  const videoResource = resources.filter((item) => /media-video|mime_type=video/i.test(item)).pop();
  const direct =
    best.currentSrc && !best.currentSrc.startsWith('blob:') && !best.currentSrc.startsWith('data:')
      ? best.currentSrc
      : '';
  // 抖音的 currentSrc 是 2.6s 占位视频；没有 MSE 的音频/视频地址时不要用它。
  const mediaUrl = audio || videoResource || (host === 'douyin.com' ? '' : direct);
  return {
    title: String(document.title || ''),
    ogTitle: pick('meta[property="og:title"]') || pick('meta[name="twitter:title"]'),
    duration: Number(best.duration) || 0,
    width: Math.round(best.getBoundingClientRect().width),
    height: Math.round(best.getBoundingClientRect().height),
    author: pick('meta[name="author"]') || pick('meta[property="og:site_name"]'),
    videoUrl,
    mediaUrl
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
      mediaUrl: String(data.mediaUrl || '')
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

/** 通用网页视频的 PageInfo：身份用页面 URL，字幕/转写走资料库。 */
export function webVideoInfo(url: string, video: DetectedVideo | null): PageInfo {
  const title = cleanTitle(video?.ogTitle || video?.title || '') || '网页视频';
  // 抖音用户页通过 modal_id 播放视频；身份与 yt-dlp 都需要 /video/<id>。
  const canonical =
    video?.videoUrl && /^https?:\/\//i.test(video.videoUrl) ? video.videoUrl : url;
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
    signature: `web:${canonical}`,
    mediaUrl: video?.mediaUrl && /^https?:\/\//i.test(video.mediaUrl) ? video.mediaUrl : undefined
  };
}
