import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import type { BridgeStatus, PageInfo } from '../shared/types';
import {
  addVideoToCollection,
  getVideoCollections,
  ingestVideo,
  librarySyncChanges,
  librarySyncCount,
  librarySyncItem,
  librarySyncItems,
  listLibrary,
  removeVideoFromCollection,
  saveNote,
  saveSummary,
  setVideoTags
} from './library';
import type { SyncLibraryItem } from './library';
import { loadSettings, saveSettings } from './settings';
import { applyCorrectionToLines } from './correction';
import { runRpc } from './bridgeRpc';
import { exportSharedSettings, importSharedSettings } from './settingsBridge';
import { localAsrReadiness, transcribeFile } from './asr';
import { listBridgeConversations, syncBridgeConversation } from './chatStore';
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_PROTOCOL,
  BridgeProtocolError,
  eventVideo,
  normalizeLines,
  normalizeTrack,
  parseEventBatch,
  type ParsedEventBatch
} from './bridgeProtocol';

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_EVENT_LOG = 500;
const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let server: http.Server | null = null;
let runningPort = 0;
let lastError = '';

/** 桌面端实例标识：插件用它判断「桌面端是否重启过」，重启后游标必须重置。 */
const instanceId = randomUUID();

interface LoggedEvent {
  seq: number;
  id: string;
  type: string;
  at: number;
  payload: unknown;
}

let eventSeq = 0;
const eventLog: LoggedEvent[] = [];
const eventWaiters = new Set<{
  since: number;
  resolve: (result: PullResult) => void;
}>();

const seenEvents = new Map<string, number>();

interface PendingApproval {
  resolve: (allow: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort: () => void;
}
const pendingApprovals = new Map<string, PendingApproval>();

/** 危险 MCP 工具审批：插件收到 NDJSON approval 事件后 POST /v1/rpc/approval。 */
function waitApproval(id: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const finish = (allow: boolean) => {
      const row = pendingApprovals.get(id);
      if (!row) return;
      pendingApprovals.delete(id);
      clearTimeout(row.timer);
      signal.removeEventListener('abort', row.onAbort);
      resolve(allow);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 120000);
    pendingApprovals.set(id, { resolve: finish, timer, onAbort });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface PullResult {
  events: Array<{ seq: number; type: string; payload: unknown; at: number }>;
  cursor: number;
  reset: boolean;
}

function pruneSeen(now: number): void {
  if (seenEvents.size < 1000) return;
  for (const [id, at] of seenEvents) {
    if (now - at > EVENT_TTL_MS) seenEvents.delete(id);
  }
  while (seenEvents.size > 1000) {
    const oldest = seenEvents.keys().next().value as string | undefined;
    if (!oldest) break;
    seenEvents.delete(oldest);
  }
}

function pushEvent(type: string, payload: unknown): void {
  eventSeq += 1;
  eventLog.push({ seq: eventSeq, id: `local-${eventSeq}`, type, at: Date.now(), payload });
  while (eventLog.length > MAX_EVENT_LOG) eventLog.shift();
  for (const waiter of [...eventWaiters]) {
    const result = collectSince(waiter.since);
    if (result.events.length) {
      eventWaiters.delete(waiter);
      waiter.resolve(result);
    }
  }
}

function collectSince(since: number): PullResult {
  // -1 = 首次连接，只拿当前游标、不回放历史；0 表示「从 seq 0 之后开始」。
  if (since < 0) return { events: [], cursor: eventSeq, reset: false };
  const oldest = eventLog.length ? eventLog[0].seq : eventSeq + 1;
  if (since < oldest - 1) return { events: [], cursor: eventSeq, reset: true };
  return {
    events: eventLog
      .filter((row) => row.seq > since)
      .map((row) => ({ seq: row.seq, type: row.type, payload: row.payload, at: row.at })),
    cursor: eventSeq,
    reset: false
  };
}

function json(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store'
  });
  response.end(body);
}

function extOrigin(request: http.IncomingMessage): string {
  return String(request.headers.origin || '');
}

function allowedDiscoveryOrigin(origin: string): boolean {
  // 扩展的 fetch 会带 chrome-extension://<id>；网页则带 https://…
  // 只让扩展读取 token，普通网站拿不到（浏览器会因缺少 ACAO 阻止读取）。
  if (!origin) return true; // 本机进程/curl
  return /^(chrome|moz)-extension:\/\//i.test(origin);
}

function jsonWithOrigin(
  response: http.ServerResponse,
  status: number,
  payload: unknown,
  origin: string
): void {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'access-control-allow-origin': origin || '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
    vary: 'origin'
  };
  response.writeHead(status, headers);
  response.end(body);
}

function authorized(request: http.IncomingMessage, token: string): boolean {
  if (!token) return false;
  return String(request.headers.authorization || '') === `Bearer ${token}`;
}

function isLoopback(request: http.IncomingMessage): boolean {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readBodyBuffer(
  request: http.IncomingMessage,
  limit = MAX_AUDIO_BYTES
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('音频分片过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

interface IngestOutcome {
  videoId: number;
  trackId: number;
  lineCount: number;
  created: boolean;
  summarySaved: boolean;
}

/** 把一条字幕事件写入库；history.upsert / video.captured 共用。 */
function ingestPayload(payload: Record<string, unknown>): IngestOutcome {
  const info = eventVideo(payload);
  const track = normalizeTrack(
    payload.track && typeof payload.track === 'object'
      ? (payload.track as Record<string, unknown>)
      : {},
    info
  );
  const lines = normalizeLines(payload.lines);
  if (!lines.length) throw new BridgeProtocolError('lines 为空');

  const correctedLines = applyCorrectionToLines(lines, loadSettings());
  const result = ingestVideo({ info, track, lines: correctedLines });
  let summarySaved = false;
  const summary = typeof payload.summary === 'string' ? payload.summary : '';
  if (summary.trim()) {
    saveSummary(info, summary, String(payload.model || 'extension'));
    summarySaved = true;
  }
  return { ...result, summarySaved };
}

function saveSummaryOnly(payload: Record<string, unknown>): void {
  const info = eventVideo(payload);
  const summary = typeof payload.summary === 'string' ? payload.summary : '';
  if (!summary.trim()) throw new BridgeProtocolError('summary 为空');
  saveSummary(info, summary, String(payload.model || 'extension'));
}

/** 同步投影 → PageInfo，用于把插件回写的总结/笔记落到既有库函数。 */
function infoFromSyncItem(item: SyncLibraryItem): PageInfo {
  return {
    ok: true,
    kind: item.kind || 'video',
    bvid: item.bvid,
    aid: null,
    cid: item.cid,
    epId: item.epId,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: item.title,
    owner: item.owner,
    desc: '',
    duration: item.duration,
    url: item.url,
    signature: ''
  };
}

function notifyLibraryChanged(win: BrowserWindow, uid: string | null): void {
  if (win && !win.isDestroyed()) win.webContents.send('library:changed', null);
  pushEvent('library.changed', uid ? { uids: [uid] } : {});
}

/** 逐条执行事件；单条失败不影响其它条。 */
function dispatchEvents(win: BrowserWindow, batch: ParsedEventBatch): Array<Record<string, unknown>> {
  const now = Date.now();
  pruneSeen(now);
  const results: Array<Record<string, unknown>> = [];
  let changed = false;

  for (const event of batch.events) {
    if (seenEvents.has(event.id)) {
      results.push({ id: event.id, ok: true, duplicate: true });
      continue;
    }
    try {
      if (event.type === 'history.upsert' || event.type === 'video.captured') {
        const outcome = ingestPayload(event.payload);
        seenEvents.set(event.id, now);
        changed = true;
        results.push({ id: event.id, ok: true, ...outcome });
        continue;
      }
      if (event.type === 'summary.saved') {
        saveSummaryOnly(event.payload);
        seenEvents.set(event.id, now);
        changed = true;
        results.push({ id: event.id, ok: true, summarySaved: true });
        continue;
      }
      // note.saved / page.context 在 M2 接入；先明确返回未实现，插件不会无限重试。
      results.push({ id: event.id, ok: false, error: `暂不支持事件类型：${event.type}` });
    } catch (error) {
      results.push({ id: event.id, ok: false, error: (error as Error)?.message || String(error) });
    }
  }

  if (changed) notifyLibraryChanged(win, null);
  return results;
}

function createHandler(win: BrowserWindow, token: string) {
  return async (request: http.IncomingMessage, response: http.ServerResponse) => {
    try {
      if (!isLoopback(request)) {
        json(response, 403, { ok: false, error: '只接受本机连接' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS'
        });
        response.end();
        return;
      }

      const url = new URL(request.url || '/', 'http://127.0.0.1');

      // 扩展自动发现：不需要用户填端口/Token。
      // 只允许扩展来源读取；网页 Origin 会因缺少 ACAO 被浏览器拦截。
      if (url.pathname === '/v1/hello' && request.method === 'GET') {
        const origin = extOrigin(request);
        if (!allowedDiscoveryOrigin(origin)) {
          json(response, 403, { ok: false, error: '只允许浏览器扩展访问' });
          return;
        }
        jsonWithOrigin(
          response,
          200,
          {
            ok: true,
            app: 'shizi',
            name: '拾字',
            protocol: BRIDGE_PROTOCOL,
            minProtocol: 1,
            version: app.getVersion(),
            instanceId,
            port: runningPort || loadSettings().bridge.port,
            token,
            capabilities: [...BRIDGE_CAPABILITIES]
          },
          origin
        );
        return;
      }

      if (url.pathname === '/v1/health') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const library = listLibrary();
        json(response, 200, {
          ok: true,
          protocol: BRIDGE_PROTOCOL,
          instanceId,
          version: app.getVersion(),
          library: { videos: library.stats.videos, segments: library.stats.segments }
        });
        return;
      }

      // v2：批量上行事件。单条失败不影响同批其它事件。
      // 增量变更：since 之后的视频 + 回收站墓碑。
      if (url.pathname === '/v1/library/changes' && request.method === 'GET') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const since = Number(url.searchParams.get('since')) || 0;
        const changes = librarySyncChanges(since);
        json(response, 200, { ok: true, protocol: BRIDGE_PROTOCOL, ...changes });
        return;
      }

      // 插件「库」页的数据源：只读、不含字幕正文。
      if (url.pathname === '/v1/library/items' && request.method === 'GET') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const items = librarySyncItems();
        const total = librarySyncCount();
        json(response, 200, {
          ok: true,
          protocol: BRIDGE_PROTOCOL,
          items,
          total,
          truncated: total > items.length,
          serverTime: Date.now()
        });
        return;
      }

      if (url.pathname === '/v1/library/item' && request.method === 'GET') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const uid = String(url.searchParams.get('uid') || '').trim();
        if (!uid) {
          json(response, 400, { ok: false, error: '缺少 uid' });
          return;
        }
        const detail = librarySyncItem(uid);
        if (!detail) {
          json(response, 404, { ok: false, error: '条目不存在' });
          return;
        }
        json(response, 200, { ok: true, protocol: BRIDGE_PROTOCOL, ...detail });
        return;
      }

      if (url.pathname === '/v1/events' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        let batch: ParsedEventBatch;
        try {
          batch = parseEventBatch(parsed);
        } catch (error) {
          json(response, 400, { ok: false, error: (error as Error)?.message || '事件格式错误' });
          return;
        }
        const results = dispatchEvents(win, batch);
        console.log(
          '[bridge] events',
          `client=${batch.client.browser}/${batch.client.version}`,
          `count=${results.length}`,
          `ok=${results.filter((row) => row.ok).length}`
        );
        json(response, 200, { ok: true, results });
        return;
      }

      // v2：下行长轮询。插件侧边栏打开时维持；没有事件时最多挂 25 秒。
      if (url.pathname === '/v1/pull' && request.method === 'GET') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const rawSince = Number(url.searchParams.get('since'));
        const since = Number.isFinite(rawSince) ? Math.floor(rawSince) : -1;
        const wait = Math.min(25000, Math.max(0, Number(url.searchParams.get('wait')) || 0));
        const immediate = collectSince(since);
        if (since < 0 || immediate.events.length || wait <= 0) {
          json(response, 200, { ok: true, protocol: BRIDGE_PROTOCOL, instanceId, ...immediate });
          return;
        }
        let aborted = false;
        const result = await new Promise<PullResult>((resolve) => {
          const waiter = {
            since,
            resolve: (value: PullResult) => {
              clearTimeout(timer);
              eventWaiters.delete(waiter);
              resolve(value);
            }
          };
          // timer 在 waiter 之后赋值，但只在 wait > 0 后触发，不会撞上 TDZ。
          const timer = setTimeout(() => waiter.resolve(collectSince(since)), wait);
          eventWaiters.add(waiter);
          response.once('close', () => {
            if (response.writableEnded) return;
            aborted = true;
            // 客户端断开：不写响应，避免 ERR_STREAM_WRITE_AFTER_END。
            waiter.resolve({ events: [], cursor: eventSeq, reset: false });
          });
        });
        if (!aborted && !response.writableEnded) {
          json(response, 200, { ok: true, protocol: BRIDGE_PROTOCOL, instanceId, ...result });
        }
        return;
      }

      // 插件回写总结（带 baseUpdatedAt 做乐观并发）。
      if (url.pathname === '/v1/library/summary' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const uid = String(payload.uid || '').trim();
        const content = typeof payload.content === 'string' ? payload.content : '';
        if (!uid || !content.trim()) {
          json(response, 400, { ok: false, error: '缺少 uid 或 content' });
          return;
        }
        const detail = librarySyncItem(uid);
        if (!detail) {
          json(response, 404, { ok: false, error: '条目不存在' });
          return;
        }
        const base = Number(payload.baseUpdatedAt) || 0;
        const current = detail.item.summaryUpdatedAt || 0;
        if (base > 0 && current > base) {
          json(response, 409, {
            ok: false,
            conflict: true,
            error: '桌面端总结已被修改',
            summary: detail.summary
          });
          return;
        }
        const model = String(payload.model || 'plugin');
        const now = Date.now();
        saveSummary(infoFromSyncItem(detail.item), content, model);
        notifyLibraryChanged(win, uid);
        json(response, 200, {
          ok: true,
          summary: { content, model, updatedAt: now }
        });
        return;
      }

      // 插件回写笔记。
      if (url.pathname === '/v1/library/note' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const uid = String(payload.uid || '').trim();
        if (!uid) {
          json(response, 400, { ok: false, error: '缺少 uid' });
          return;
        }
        const detail = librarySyncItem(uid);
        if (!detail) {
          json(response, 404, { ok: false, error: '条目不存在' });
          return;
        }
        const base = Number(payload.baseUpdatedAt) || 0;
        const current = detail.item.noteUpdatedAt || 0;
        if (base > 0 && current > base) {
          json(response, 409, {
            ok: false,
            conflict: true,
            error: '桌面端笔记已被修改',
            note: detail.note
          });
          return;
        }
        const note = saveNote(detail.item.id, typeof payload.content === 'string' ? payload.content : '');
        notifyLibraryChanged(win, uid);
        json(response, 200, { ok: true, note });
        return;
      }

      // 共享设置快照：插件首次连接迁移 / 主端权威使用。
      if (url.pathname === '/v1/settings/shared' && request.method === 'GET') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const includeSecrets = url.searchParams.get('includeSecrets') === '1';
        const payload = exportSharedSettings(includeSecrets);
        json(response, 200, { ok: true, settings: payload, includesSecrets: includeSecrets });
        return;
      }

      if (url.pathname === '/v1/settings/shared' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const settings = payload.settings && typeof payload.settings === 'object'
          ? (payload.settings as Record<string, unknown>)
          : payload;
        try {
          importSharedSettings(settings as never);
          json(response, 200, { ok: true });
        } catch (error) {
          json(response, 400, { ok: false, error: (error as Error)?.message || '导入失败' });
        }
        return;
      }

      // 危险 MCP 工具审批。
      if (url.pathname === '/v1/rpc/approval' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const id = String(payload.id || '');
        const pending = pendingApprovals.get(id);
        if (!pending) {
          json(response, 404, { ok: false, error: '审批请求不存在或已过期' });
          return;
        }
        pending.resolve(payload.allow === true);
        json(response, 200, { ok: true });
        return;
      }

      // 插件对话同步：按 conversationKey 整段替换进 chat.db。
      if (url.pathname === '/v1/chat/sync' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const messages = Array.isArray(payload.messages)
          ? payload.messages.map((item) => {
              const row = (item || {}) as Record<string, unknown>;
              return {
                role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
                content: String(row.content || ''),
                reasoning: String(row.reasoning || '')
              };
            })
          : [];
        const result = syncBridgeConversation({
          key: String(payload.key || ''),
          videoKey: String(payload.videoKey || ''),
          videoTitle: String(payload.videoTitle || ''),
          messages
        });
        json(response, 200, { ok: true, ...result });
        return;
      }

      // 插件首次迁移：拉回桥接会话。
      if (url.pathname === '/v1/chat/export' && request.method === 'GET') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const conversations = listBridgeConversations(500);
        json(response, 200, { ok: true, conversations });
        return;
      }

      // 插件回写标签（整组替换；空数组表示清空）。
      if (url.pathname === '/v1/library/tags' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const uid = String(payload.uid || '').trim();
        const detail = uid ? librarySyncItem(uid) : null;
        if (!detail) {
          json(response, 404, { ok: false, error: '条目不存在' });
          return;
        }
        const tags = Array.isArray(payload.tags)
          ? payload.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 30)
          : [];
        const saved = setVideoTags(detail.item.id, tags);
        notifyLibraryChanged(win, uid);
        json(response, 200, { ok: true, tags: saved });
        return;
      }

      // 插件回写合集（整组替换：补齐新增、移除不在列表里的）。
      if (url.pathname === '/v1/library/collections' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const uid = String(payload.uid || '').trim();
        const detail = uid ? librarySyncItem(uid) : null;
        if (!detail) {
          json(response, 404, { ok: false, error: '条目不存在' });
          return;
        }
        const wanted = Array.isArray(payload.collections)
          ? payload.collections.map((name) => String(name || '').trim()).filter(Boolean).slice(0, 30)
          : [];
        const current = getVideoCollections(detail.item.id);
        for (const name of current) {
          if (!wanted.includes(name)) removeVideoFromCollection(detail.item.id, name);
        }
        for (const name of wanted) {
          if (!current.includes(name)) addVideoToCollection(detail.item.id, name);
        }
        const next = getVideoCollections(detail.item.id);
        notifyLibraryChanged(win, uid);
        json(response, 200, { ok: true, collections: next });
        return;
      }

      // v2：插件分片音频 → 桌面本地 Whisper 识别（失败由插件回退在线 ASR）。
      if (url.pathname === '/v1/asr' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const readiness = localAsrReadiness();
        if (!readiness.ready) {
          json(response, 409, { ok: false, error: readiness.reason || '桌面端本地 Whisper 不可用' });
          return;
        }
        const audio = await readBodyBuffer(request);
        if (!audio.length) {
          json(response, 400, { ok: false, error: '音频为空' });
          return;
        }
        const ext = (url.searchParams.get('format') || 'wav').toLowerCase() === 'm4a' ? 'm4a' : 'wav';
        const duration = Math.max(0, Number(url.searchParams.get('duration')) || 0);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-bridge-asr-'));
        const file = path.join(dir, `slice.${ext}`);
        fs.writeFileSync(file, audio);
        const controller = new AbortController();
        response.on('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        const info: PageInfo = {
          ok: true,
          kind: 'video',
          bvid: null,
          aid: null,
          cid: null,
          epId: null,
          seasonId: null,
          page: 1,
          partTitle: '',
          parts: [],
          title: String(url.searchParams.get('title') || '插件音频分片'),
          owner: '',
          desc: '',
          duration,
          url: String(url.searchParams.get('url') || ''),
          signature: ''
        };
        try {
          const out = await transcribeFile(file, info, () => {}, controller.signal);
          json(response, 200, {
            ok: true,
            model: out.model,
            text: out.lines.map((line) => line.text).join(''),
            segments: out.lines.map((line) => ({
              t: line.start,
              d: Math.max(0.3, line.end - line.start),
              text: line.text
            }))
          });
        } finally {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
        return;
      }

      // v2：插件调用桌面能力（AI 总结/对话、脱敏设置读取）。
      if (url.pathname === '/v1/rpc' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }
        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        const method = String(payload.method || '').trim();
        const params =
          payload.params && typeof payload.params === 'object'
            ? (payload.params as Record<string, unknown>)
            : {};
        if (!method) {
          json(response, 400, { ok: false, error: '缺少 method' });
          return;
        }

        const controller = new AbortController();
        const stream = payload.stream === true || method.startsWith('ai.');
        if (!stream) {
          const events: Array<Record<string, unknown>> = [];
          try {
            await runRpc(method, params, controller.signal, (event) => events.push(event));
            const done = events.find((event) => event.type === 'done');
            if (!done) throw new Error('没有返回结果');
            json(response, 200, { ok: true, ...done });
          } catch (error) {
            const message = (error as Error)?.message || String(error);
            json(response, 400, { ok: false, error: message });
          }
          return;
        }

        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS'
        });
        let closed = false;
        response.on('close', () => {
          if (!response.writableEnded) {
            closed = true;
            controller.abort();
          }
        });
        const emit = (event: Record<string, unknown>) => {
          if (closed || response.writableEnded) return;
          try {
            response.write(JSON.stringify(event) + '\n');
          } catch {
            closed = true;
          }
        };

        try {
          const onApproval = async (request: { name: string; detail: string }) => {
            const id = randomUUID();
            emit({ type: 'approval', id, name: request.name, detail: request.detail });
            return waitApproval(id, controller.signal);
          };
          await runRpc(method, params, controller.signal, emit, { onApproval });
        } catch (error) {
          const message = (error as Error)?.message || String(error);
          if (!(error as Error)?.name?.includes('Abort')) {
            emit({ type: 'error', error: message });
          }
        } finally {
          if (!closed && !response.writableEnded) response.end();
        }
        return;
      }

      // v1 兼容：旧的单条推送。
      if (url.pathname === '/v1/ingest' && request.method === 'POST') {
        if (!authorized(request, token)) {
          json(response, 401, { ok: false, error: 'token 无效' });
          return;
        }

        const body = await readBody(request);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body);
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }

        if (!payload || typeof payload !== 'object' || !payload.video) {
          json(response, 400, { ok: false, error: '缺少 video 字段' });
          return;
        }

        const outcome = ingestPayload(payload);
        notifyLibraryChanged(win, null);
        console.log(
          '[bridge] ingest',
          String((payload.video as Record<string, unknown>).bvid || ''),
          `lines=${outcome.lineCount}`,
          `summary=${outcome.summarySaved}`
        );
        json(response, 200, { ok: true, ...outcome });
        return;
      }

      json(response, 404, { ok: false, error: 'not found' });
    } catch (error) {
      lastError = (error as Error)?.message || String(error);
      console.warn('[bridge] error:', lastError);
      json(response, 500, { ok: false, error: lastError });
    }
  };
}

function listenOnce(win: BrowserWindow, token: string, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const candidate = http.createServer(createHandler(win, token));
    const onError = (error: NodeJS.ErrnoException) => {
      candidate.removeListener('listening', onListening);
      candidate.close();
      reject(error);
    };
    const onListening = () => {
      candidate.removeListener('error', onError);
      resolve(candidate);
    };
    // 总结/长对话可能超过 Node 默认 5 分钟请求超时；由客户端断开控制取消。
    candidate.requestTimeout = 0;
    candidate.headersTimeout = 60000;
    candidate.once('error', onError);
    candidate.once('listening', onListening);
    candidate.listen(port, '127.0.0.1');
  });
}

export async function startBridge(win: BrowserWindow): Promise<BridgeStatus> {
  stopBridge();
  lastError = '';

  const settings = loadSettings();
  if (!settings.bridge.enabled) {
    return bridgeStatus();
  }

  let token = settings.bridge.token;
  if (!token) {
    token = randomBytes(24).toString('hex');
    saveSettings({ ...settings, bridge: { ...settings.bridge, token } });
    console.log('[bridge] generated token');
  }

  const basePort = settings.bridge.port || 47821;
  for (let offset = 0; offset < 10; offset += 1) {
    try {
      server = await listenOnce(win, token, basePort + offset);
      runningPort = (server.address() as AddressInfo).port;
      console.log('[bridge] listening', `http://127.0.0.1:${runningPort}/v1/ingest`);
      return bridgeStatus();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') {
        lastError = (error as Error).message;
        console.warn('[bridge] start failed:', lastError);
        break;
      }
    }
  }

  return bridgeStatus();
}

export function stopBridge(): void {
  if (server) {
    try {
      server.close();
      server.closeAllConnections?.();
    } catch {
      // ignore
    }
    server = null;
    runningPort = 0;
  }
  for (const waiter of [...eventWaiters]) {
    eventWaiters.delete(waiter);
    waiter.resolve({ events: [], cursor: eventSeq, reset: false });
  }
  for (const pending of [...pendingApprovals.values()]) {
    pending.resolve(false);
  }
}

export async function restartBridge(win: BrowserWindow): Promise<BridgeStatus> {
  stopBridge();
  return startBridge(win);
}

export function bridgeStatus(): BridgeStatus {
  const settings = loadSettings();
  return {
    enabled: settings.bridge.enabled,
    running: Boolean(server),
    port: runningPort || settings.bridge.port,
    token: settings.bridge.token,
    error: lastError || undefined
  };
}

/** 供测试/联动脚本读取的当前实例信息。 */
export function bridgeInstance(): { instanceId: string; protocol: number; seq: number } {
  return { instanceId, protocol: BRIDGE_PROTOCOL, seq: eventSeq };
}
