import type { PageInfo, SubtitleTrack } from '../../../shared/types';

export function isVideoKey(key: string): boolean {
  return key.startsWith('v:') || key.startsWith('e:') || key.startsWith('y:');
}

function youtubeId(parsed: URL): string {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
    const match = /\/(?:shorts|embed|live)\/([\w-]+)/.exec(parsed.pathname);
    return match ? match[1] : '';
  }
  return '';
}

// B 站是单页应用，?vd_source / ?spm_id_from 这类 query 变化不应触发重新抓取。
// 只按「视频 + 分 P」生成 key；YouTube 按 videoId，忽略 t / list 参数。
export function videoKeyOf(url?: string): string {
  if (!url || url === 'about:blank') return '';
  try {
    const parsed = new URL(url);
    const youtube = youtubeId(parsed);
    if (youtube) return `y:${youtube}`;
    if (!/(^|\.)bilibili\.com$/i.test(parsed.hostname)) return `u:${parsed.href}`;
    const bv = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/i);
    const ep = parsed.pathname.match(/\/bangumi\/play\/(ep\d+)/i);
    const p = parsed.searchParams.get('p') || '1';
    if (bv) return `v:${bv[1]}:p${p}`;
    if (ep) return `e:${ep[1]}`;
    return `u:${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** PageInfo 的身份 key：优先用页面状态里的 bvid/epId，没有才退回 URL。 */
export function pageInfoKey(info: PageInfo | null | undefined): string {
  if (!info) return '';
  const urlKey = videoKeyOf(info.url);
  // 番剧页：状态里的 epId 可能是数字（123），URL 里是 ep123。
  if (info.epId && urlKey.startsWith('e:')) {
    const id = String(info.epId);
    return `e:${/^ep\d+$/i.test(id) ? id : /^\d+$/.test(id) ? `ep${id}` : id}`;
  }
  if (info.bvid) return `v:${info.bvid}:p${Number(info.page) || 1}`;
  if (info.epId) return `e:${info.epId}`;
  return urlKey;
}

export interface TrackPreference {
  lan: string;
  source?: string;
  isAi?: boolean;
}

/** WBI 签名接口 > 播放器自报 > 初始状态/嗅探。 */
function sourceRank(source: string): number {
  const value = String(source || '');
  if (value === 'player/wbi/v2') return 300;
  if (value === 'player.getSubtitle') return 200;
  return 100;
}

function langRank(lan: string): number {
  const value = String(lan || '').toLowerCase();
  if (value === 'zh-cn' || value === 'zh-hans') return 40;
  if (value.startsWith('zh')) return 35;
  if (value === 'ai-zh') return 30;
  return 10;
}

const TRACK_CHOICE_KEY = 'shizi.trackChoice.v1';

export function trackChoiceKey(info: PageInfo | null): string {
  if (!info) return '';
  return `${videoKeyOf(info.url)}|${info.cid || ''}`;
}

export function readTrackChoice(info: PageInfo | null): TrackPreference | null {
  const key = trackChoiceKey(info);
  if (!key) return null;
  try {
    const raw = globalThis.localStorage?.getItem(TRACK_CHOICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, TrackPreference>;
    return parsed && typeof parsed[key] === 'object' ? parsed[key] : null;
  } catch {
    return null;
  }
}

export function writeTrackChoice(info: PageInfo | null, track: SubtitleTrack): void {
  const key = trackChoiceKey(info);
  if (!key || !track) return;
  try {
    const raw = globalThis.localStorage?.getItem(TRACK_CHOICE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, TrackPreference>) : {};
    parsed[key] = { lan: track.lan, source: track.source, isAi: Boolean(track.isAi) };
    globalThis.localStorage?.setItem(TRACK_CHOICE_KEY, JSON.stringify(parsed));
  } catch {
    // 本地记忆失败不影响选轨
  }
}

export function pickTrack(
  tracks: SubtitleTrack[],
  info: PageInfo | null,
  preferred?: TrackPreference | null
): SubtitleTrack | null {
  if (!tracks.length) return null;
  if (preferred && preferred.lan) {
    const matched = tracks.find(
      (track) =>
        track.lan === preferred.lan &&
        (preferred.source == null || track.source === preferred.source) &&
        (preferred.isAi == null || Boolean(track.isAi) === Boolean(preferred.isAi))
    );
    if (matched) return matched;
  }

  const cid = info?.cid ? String(info.cid) : '';
  const aid = info?.aid ? String(info.aid) : '';

  const rank = (track: SubtitleTrack) => {
    let value = sourceRank(track.source) * 1000;
    // 同来源下，URL 带当前 cid/aid 的轨身份更可信；不参与跨来源比较。
    if (cid && track.url.includes(cid)) value += 200;
    if (aid && track.url.includes(aid)) value += 100;
    value += langRank(track.lan) * 2;
    if (!track.isAi) value += 1;
    return value;
  };

  // 保留平台返回顺序：分数相同不重排，稳定取第一条。
  let best = tracks[0];
  let bestScore = rank(tracks[0]);
  for (const track of tracks.slice(1)) {
    const score = rank(track);
    if (score > bestScore) {
      best = track;
      bestScore = score;
    }
  }
  return best;
}
