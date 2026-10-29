import type { PageInfo, SubtitleLine, SubtitleTrack } from '../shared/types';

/** 协议版本：v2 增加能力声明、批量事件与下行拉取；v1 的 /v1/ingest 继续保留。 */
export const BRIDGE_PROTOCOL = 2;

/** 当前桌面端能提供的桥能力。插件只按这里声明的方法调用，避免按版本猜。 */
export const BRIDGE_CAPABILITIES = [
  'ingest',
  'events',
  'pull',
  'library.read',
  'library.changes',
  'ai.chat',
  'ai.summarize',
  'asr.local',
  'tts',
  'export',
  'translate',
  'optimize',
  'chat.sync',
  'settings.read'
] as const;

/** 上行事件类型。新类型必须同时更新插件 desktop-link 与 docs/EXTENSION-DESKTOP-ALIGNMENT.md。 */
export const BRIDGE_EVENT_TYPES = [
  'history.upsert',
  'video.captured',
  'summary.saved',
  'note.saved',
  'page.context'
] as const;

export type BridgeEventType = (typeof BRIDGE_EVENT_TYPES)[number];

export interface BridgeEvent {
  id: string;
  type: BridgeEventType;
  at: number;
  payload: Record<string, unknown>;
}

export interface BridgeClient {
  id: string;
  browser: string;
  version: string;
}

export interface ParsedEventBatch {
  protocol: number;
  client: BridgeClient;
  events: BridgeEvent[];
}

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeProtocolError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return value == null ? '' : String(value);
}

/** 插件侧的 video 对象 → 桌面 PageInfo。字段缺失时给安全默认值。 */
export function normalizeVideo(video: Record<string, unknown>): PageInfo {
  const bvid = video.bvid ? String(video.bvid) : null;
  const cid = video.cid == null ? null : Number(video.cid);
  const rawPoints = Array.isArray(video.viewPoints) ? video.viewPoints : [];
  return {
    ok: true,
    kind: textOf(video.kind) || 'video',
    bvid,
    aid: video.aid == null ? null : Number(video.aid),
    cid,
    epId: video.epId == null ? null : Number(video.epId),
    seasonId: video.seasonId == null ? null : Number(video.seasonId),
    page: Number(video.page) || 1,
    partTitle: textOf(video.partTitle),
    parts: [],
    title: textOf(video.title),
    owner: textOf(video.owner),
    desc: textOf(video.desc),
    duration: Number(video.duration) || 0,
    url: textOf(video.url) || (bvid ? `https://www.bilibili.com/video/${bvid}` : ''),
    signature: textOf(video.signature),
    cover: video.cover ? String(video.cover) : undefined,
    pubdate: video.pubdate == null ? undefined : Number(video.pubdate),
    viewPoints: rawPoints
      .map((point) => {
        const row = asRecord(point);
        const start = Number(row.start != null ? row.start : row.from) || 0;
        const end = Number(row.end != null ? row.end : row.to) || 0;
        return {
          title: textOf(row.title || row.content),
          start,
          end
        };
      })
      .filter((point) => point.title)
  };
}

export function normalizeTrack(
  track: Record<string, unknown>,
  info: PageInfo
): SubtitleTrack {
  return {
    lan: textOf(track.lan),
    lanDoc: textOf(track.lanDoc || track.lan),
    url: textOf(track.url) || `extension://${info.bvid || info.cid || 'unknown'}`,
    isAi: Boolean(track.isAi),
    aiStatus: track.aiStatus == null ? null : Number(track.aiStatus),
    source: textOf(track.source) || 'extension'
  };
}

export function normalizeLines(raw: unknown): SubtitleLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => {
      const row = asRecord(line);
      return {
        start: Math.max(0, Number(row.start) || 0),
        end: Math.max(0, Number(row.end) || 0),
        text: textOf(row.text).trim()
      };
    })
    .filter((line) => line.text.length > 0);
}

function isEventType(value: string): value is BridgeEventType {
  return (BRIDGE_EVENT_TYPES as readonly string[]).includes(value);
}

/** 校验 /v1/events 的请求体；任何结构错误都抛出可直接返回给插件的说明。 */
export function parseEventBatch(raw: unknown): ParsedEventBatch {
  const body = asRecord(raw);
  const list = body.events;
  if (!Array.isArray(list)) throw new BridgeProtocolError('缺少 events 数组');
  if (list.length === 0) throw new BridgeProtocolError('events 为空');
  if (list.length > 50) throw new BridgeProtocolError('单次最多 50 条事件');

  const now = Date.now();
  const seen = new Set<string>();
  const events: BridgeEvent[] = [];

  for (const item of list) {
    const row = asRecord(item);
    const id = textOf(row.id).trim();
    if (!id) throw new BridgeProtocolError('事件缺少 id');
    if (seen.has(id)) continue;
    seen.add(id);
    const type = textOf(row.type).trim();
    if (!isEventType(type)) throw new BridgeProtocolError(`未知事件类型：${type}`);
    const payload = asRecord(row.payload);
    if (!Object.keys(payload).length) throw new BridgeProtocolError(`事件 ${id} 缺少 payload`);
    events.push({
      id,
      type,
      at: Number(row.at) > 0 ? Number(row.at) : now,
      payload
    });
  }

  const client = asRecord(body.client);
  return {
    protocol: Number(body.protocol) || 0,
    client: {
      id: textOf(client.id) || 'unknown',
      browser: textOf(client.browser) || 'unknown',
      version: textOf(client.version) || 'unknown'
    },
    events
  };
}

/** 从事件 payload 中取出视频；history/ video / summary 事件都要求有 video。 */
export function eventVideo(payload: Record<string, unknown>): PageInfo {
  const info = normalizeVideo(asRecord(payload.video));
  if (!info.bvid && !info.epId && !info.url) {
    throw new BridgeProtocolError('事件缺少 video 身份（bvid/epId/url）');
  }
  return info;
}
