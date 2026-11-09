import type { WebContents } from 'electron';
import type { PageInfo } from '../shared/types';

export interface DetectedVideo {
  title: string;
  ogTitle: string;
  duration: number;
  width: number;
  height: number;
  author: string;
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
  return {
    title: String(document.title || ''),
    ogTitle: pick('meta[property="og:title"]') || pick('meta[name="twitter:title"]'),
    duration: Number(best.duration) || 0,
    width: Math.round(best.getBoundingClientRect().width),
    height: Math.round(best.getBoundingClientRect().height),
    author: pick('meta[name="author"]') || pick('meta[property="og:site_name"]')
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
      author: String(data.author || '')
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
    url,
    signature: `web:${url}`
  };
}
