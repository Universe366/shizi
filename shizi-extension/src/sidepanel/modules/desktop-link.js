// 插件 ↔ 桌面端连接层（协议 v2）。
//
// 目标：
//   1. 自动发现桌面端，用户不用点按钮、不用填端口/Token；
//   2. 保存字幕/总结后自动入队并上报，桌面端不在时留在 IndexedDB，重连补传；
//   3. 侧边栏打开时维持一条下行长轮询，桌面端可以主动通知（库变更/设置变更）；
//   4. 没有桌面端时所有调用都安全失败，不影响插件独立使用。
//
// 协议见 desktop/docs/BRIDGE.md 与 docs/EXTENSION-DESKTOP-ALIGNMENT.md。

import { CONTENT_VERSION } from '../../shared/constants.js';
import {
  db,
  libraryAll,
  libraryDeleteMany,
  libraryPutAll,
  libraryReplaceAll,
  outboxAll,
  outboxDel,
  outboxPut,
  STORES
} from '../../shared/storage.js';
import { loadSettings, saveSettings, store } from './store.js';

const DISCOVERY_PORTS = Array.from({ length: 10 }, (_, index) => 47821 + index);
const META_KEY = 'bsub.desktopSync.v1';
const MAX_OUTBOX = 20;
const CONNECT_TTL_MS = 30000;
const RETRY_TTL_MS = 8000;

/** @type {{state:string, port:number, token:string, version:string, protocol:number, instanceId:string, capabilities:string[], library:any, error:string, lastSeen:number, lastSyncAt:number, pending:number, lastRemoteChangeAt:number}} */
let link = {
  state: 'idle',
  port: 0,
  token: '',
  version: '',
  protocol: 1,
  instanceId: '',
  capabilities: [],
  library: null,
  error: '',
  lastSeen: 0,
  lastSyncAt: 0,
  pending: 0,
  lastRemoteChangeAt: 0,
  librarySyncedAt: 0
};

const listeners = new Set();
let discovery = null;
let lastAttemptAt = 0;
let snapshotTimer = null;
let flushPromise = null;
let polling = false;
let pollAbort = null;

export function linkStatus() {
  return { ...link, capabilities: [...link.capabilities] };
}

export function onLinkChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(linkStatus());
    } catch (err) {
      console.error('[拾字] 桌面端状态回调异常', err);
    }
  }
}

function patchLink(patch) {
  link = { ...link, ...patch };
  emit();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEmbeddedPanel() {
  try {
    return new URLSearchParams(location.search).get('embed') === '1';
  } catch (err) {
    return false;
  }
}

function detectBrowser() {
  try {
    const ua = navigator.userAgent || '';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Firefox\//.test(ua)) return 'firefox';
    return 'chrome';
  } catch (err) {
    return 'chrome';
  }
}

export function clientId() {
  try {
    return chrome.runtime.id || 'extension';
  } catch (err) {
    return 'extension';
  }
}

function uuid() {
  try {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (err) {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** FNV-1a：只用来判断「内容有没有变」，不做安全用途。 */
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// ---------------------------------------------------------------------------
// 同步元数据（游标 / 已发送内容哈希）
// ---------------------------------------------------------------------------

async function readMeta() {
  try {
    const got = await chrome.storage.local.get(META_KEY);
    const raw = got && got[META_KEY];
    return {
      // -1 = 还没拉取过；服务端会返回当前游标，之后从 0 开始收增量。
      cursor:
        raw && raw.cursor != null && Number.isFinite(Number(raw.cursor))
          ? Number(raw.cursor)
          : -1,
      instanceId: String((raw && raw.instanceId) || ''),
      librarySince: raw && Number(raw.librarySince) > 0 ? Number(raw.librarySince) : 0,
      hashes: raw && raw.hashes && typeof raw.hashes === 'object' ? raw.hashes : {}
    };
  } catch (err) {
    return { cursor: -1, instanceId: '', librarySince: 0, hashes: {} };
  }
}

async function writeMeta(patch) {
  const current = await readMeta();
  const next = { ...current, ...patch };
  try {
    await chrome.storage.local.set({ [META_KEY]: next });
  } catch (err) {
    /* 元数据写失败不影响本次上报 */
  }
  return next;
}

async function rememberSent(uid, hash) {
  const meta = await readMeta();
  const hashes = { ...meta.hashes, [uid]: hash };
  const keys = Object.keys(hashes);
  if (keys.length > 300) {
    for (const key of keys.slice(0, keys.length - 300)) delete hashes[key];
  }
  await writeMeta({ hashes });
}

// ---------------------------------------------------------------------------
// 发现
// ---------------------------------------------------------------------------

async function fetchHello(port, timeoutMs = 700) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/hello`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || data.app !== 'shizi' || !data.token) return null;
    return {
      port: Number(data.port) || port,
      token: String(data.token),
      version: String(data.version || ''),
      protocol: Number(data.protocol) || 1,
      instanceId: String(data.instanceId || ''),
      capabilities: Array.isArray(data.capabilities) ? data.capabilities.map(String) : []
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 自动发现本机桌面端。preferredPort 先试，其余端口兜底。 */
export async function discoverDesktop(preferredPort) {
  const ports = [
    ...new Set([Number(preferredPort) || 0, ...DISCOVERY_PORTS].filter(Boolean))
  ];
  for (const port of ports) {
    const found = await fetchHello(port);
    if (found) return found;
  }
  return null;
}

async function persistConnection(found) {
  const settings = store.get().settings;
  if (!settings) return;
  const cfg = settings.desktop || {};
  if (Number(cfg.port) === found.port && String(cfg.token || '') === found.token) return;
  try {
    await saveSettings({
      ...settings,
      desktop: {
        ...cfg,
        enabled: cfg.enabled !== false,
        port: found.port,
        token: found.token
      }
    });
  } catch (err) {
    /* 保存失败不影响连接 */
  }
}

/** 确保连接可用；force 时跳过缓存。失败返回 null，不抛错。 */
export async function ensureLink(force = false) {
  const fresh = Date.now() - link.lastSeen < CONNECT_TTL_MS;
  if (!force && link.state === 'connected' && fresh) return linkStatus();

  const cooling =
    !force && link.state === 'offline' && Date.now() - lastAttemptAt < RETRY_TTL_MS;
  if (cooling) return null;

  if (discovery) return discovery;
  lastAttemptAt = Date.now();
  patchLink({ state: 'connecting', error: '' });

  discovery = (async () => {
    const preferredPort = Number(store.get().settings?.desktop?.port) || 47821;
    const found = await discoverDesktop(preferredPort);
    if (!found) {
      patchLink({ state: 'offline', error: '未检测到桌面端', library: null });
      return null;
    }
    patchLink({
      state: 'connected',
      port: found.port,
      token: found.token,
      version: found.version,
      protocol: found.protocol,
      instanceId: found.instanceId,
      capabilities: found.capabilities,
      lastSeen: Date.now(),
      error: ''
    });
    await persistConnection(found);
    return linkStatus();
  })()
    .catch((err) => {
      patchLink({ state: 'offline', error: (err && err.message) || String(err) });
      return null;
    })
    .finally(() => {
      discovery = null;
    });

  return discovery;
}

async function fetchHealth(conn) {
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}/v1/health`, {
      headers: { authorization: `Bearer ${conn.token}` },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return data && data.ok ? data : null;
  } catch (err) {
    return null;
  }
}

/** 立即探测一次并刷新库统计；设置页与启动时调用。 */
export async function probeDesktop() {
  const conn = await ensureLink(true);
  if (!conn) return null;
  const health = await fetchHealth(conn);
  if (!health) {
    patchLink({ state: 'offline', error: '桌面端无响应' });
    return null;
  }
  patchLink({
    state: 'connected',
    version: String(health.version || conn.version || ''),
    protocol: Number(health.protocol) || conn.protocol,
    instanceId: String(health.instanceId || conn.instanceId || ''),
    library: health.library || null,
    lastSeen: Date.now(),
    error: ''
  });
  void syncLibrary().catch(() => {});
  if (!isEmbeddedPanel()) void pollLoop();
  return linkStatus();
}

// ---------------------------------------------------------------------------
// 快照与上行
// ---------------------------------------------------------------------------

const LANG_LABELS = {
  'ai-zh': '中文（AI）',
  'zh-CN': '中文',
  'zh-Hans': '中文',
  'zh-Hant': '繁體中文',
  'en-US': 'English',
  ja: '日本語'
};

function lineTimes(line) {
  const start = Number(line && (line.from != null ? line.from : line.start));
  const end = Number(line && (line.to != null ? line.to : line.end));
  return {
    start: Number.isFinite(start) ? Math.max(0, start) : 0,
    end: Number.isFinite(end) ? Math.max(0, end) : 0
  };
}

export function buildSnapshotPayload(state) {
  const video = state && state.video;
  if (!video) throw new Error('还没有读取视频');
  const lines = Array.isArray(state.subtitles) ? state.subtitles : [];
  if (!lines.length) throw new Error('还没有字幕可同步');

  const meta = video.subtitleMeta || state.subtitleMeta || {};
  const lan = String(meta.lang || 'zh-CN');
  const isAi = /^ai-/.test(lan) || meta.isAi === true;
  const url =
    video.url || (video.bvid ? `https://www.bilibili.com/video/${video.bvid}` : '');

  const settings = state.settings || store.get().settings || {};
  const platforms = (settings.ai && settings.ai.platforms) || [];
  const active = platforms.find((row) => row.id === (settings.ai && settings.ai.activeId));
  const model = String((active && active.model) || '');

  return {
    protocolVersion: 2,
    video: {
      bvid: video.bvid || null,
      cid: video.cid == null ? null : Number(video.cid),
      epId: video.epId == null ? null : Number(video.epId),
      page: video.page == null ? 1 : Number(video.page),
      partTitle: String(video.partTitle || ''),
      title: String(video.title || ''),
      owner: String(video.owner || ''),
      duration: Number(video.duration) || 0,
      url,
      cover: String(video.cover || ''),
      signature: String(video.signature || ''),
      desc: String(video.desc || '')
    },
    track: {
      lan,
      lanDoc: String(meta.langDoc || meta.language || LANG_LABELS[lan] || lan || '中文'),
      source: 'extension',
      isAi,
      url: `extension://${video.signature || video.bvid || 'current'}`
    },
    lines: lines
      .map((line) => {
        const text = String((line && line.text) || '').trim();
        if (!text) return null;
        const times = lineTimes(line);
        return { start: times.start, end: times.end, text };
      })
      .filter(Boolean),
    summary: typeof state.summary === 'string' ? state.summary : '',
    model
  };
}

function uidOf(video) {
  if (video.bvid) return `v:${video.bvid}:${video.cid || 0}`;
  if (video.epId) return `e:${video.epId}:${video.cid || 0}`;
  return `u:${video.url || video.title || 'unknown'}`;
}

/** 把当前状态写进离线队列（同一视频覆盖）。默认会做内容去重。 */
export async function queueSnapshot(state = store.get(), options = {}) {
  const settings = state.settings || store.get().settings || {};
  const cfg = settings.desktop || {};
  if (cfg.enabled === false) return { queued: false, reason: 'disabled' };
  if (options.force !== true && cfg.autoSync === false) return { queued: false, reason: 'auto-off' };
  if (!state.video || !Array.isArray(state.subtitles) || !state.subtitles.length) {
    return { queued: false, reason: 'empty' };
  }

  let payload;
  try {
    payload = buildSnapshotPayload(state);
  } catch (err) {
    return { queued: false, reason: (err && err.message) || String(err) };
  }
  if (!payload.lines.length) return { queued: false, reason: 'empty' };

  const uid = uidOf(payload.video);
  const hash = hashText(
    JSON.stringify({
      title: payload.video.title,
      owner: payload.video.owner,
      duration: payload.video.duration,
      lang: payload.track.lan,
      lines: payload.lines,
      summary: payload.summary
    })
  );

  if (options.force !== true) {
    const meta = await readMeta();
    if (meta.hashes[uid] === hash) return { queued: false, reason: 'unchanged' };
  }

  const row = {
    key: uid,
    hash,
    queuedAt: Date.now(),
    attempts: 0,
    event: {
      id: uuid(),
      type: 'history.upsert',
      at: Date.now(),
      payload: {
        video: payload.video,
        track: payload.track,
        lines: payload.lines,
        summary: payload.summary,
        model: payload.model
      }
    }
  };
  await outboxPut(row);
  await pruneOutbox();
  patchLink({ pending: await countOutbox() });
  scheduleFlush(600);
  return { queued: true, uid };
}

export function scheduleSnapshot(state = store.get()) {
  const settings = state.settings || store.get().settings || {};
  const cfg = settings.desktop || {};
  if (cfg.enabled === false || cfg.autoSync === false) return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    queueSnapshot(store.get()).catch(() => {});
  }, 1500);
}

async function countOutbox() {
  try {
    return await db.count(STORES.STORE_OUTBOX);
  } catch (err) {
    return 0;
  }
}

async function pruneOutbox() {
  const rows = await outboxAll();
  if (rows.length <= MAX_OUTBOX) return;
  for (const row of rows.slice(0, rows.length - MAX_OUTBOX)) {
    await outboxDel(row.key);
  }
}

let flushTimer = null;
function scheduleFlush(delay = 600) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushOutbox().catch(() => {});
  }, delay);
}

async function postEvents(conn, events) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.token}`
      },
      body: JSON.stringify({
        protocol: 2,
        client: {
          id: clientId(),
          browser: detectBrowser(),
          version: CONTENT_VERSION
        },
        events
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const error = new Error('桌面端 Token 已失效');
      error.code = 'unauthorized';
      throw error;
    }
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || `桌面端返回 HTTP ${response.status}`);
      error.code = 'bad-response';
      throw error;
    }
    return Array.isArray(data.results) ? data.results : [];
  } finally {
    clearTimeout(timer);
  }
}

/** 把队列推给桌面端；失败保留，重连后继续。 */
export async function flushOutbox(options = {}) {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const rows = await outboxAll();
    patchLink({ pending: rows.length });
    if (!rows.length) return { pushed: 0, failed: 0, pending: 0 };

    let conn = await ensureLink(Boolean(options.force));
    if (!conn) return { pushed: 0, failed: 0, pending: rows.length };

    const batch = rows.slice(0, 20);
    let results;
    try {
      results = await postEvents(
        conn,
        batch.map((row) => row.event)
      );
    } catch (err) {
      if (err && err.code === 'unauthorized') {
        patchLink({ state: 'offline', token: '', error: '桌面端 Token 已失效，正在重新发现' });
        conn = await ensureLink(true);
        if (conn) {
          try {
            results = await postEvents(
              conn,
              batch.map((row) => row.event)
            );
          } catch (second) {
            return { pushed: 0, failed: batch.length, pending: rows.length };
          }
        } else {
          return { pushed: 0, failed: batch.length, pending: rows.length };
        }
      } else {
        return { pushed: 0, failed: batch.length, pending: rows.length };
      }
    }

    const byId = new Map(results.map((row) => [String(row.id), row]));
    let pushed = 0;
    let failed = 0;
    for (const row of batch) {
      const result = byId.get(String(row.event.id));
      if (result && result.ok) {
        await outboxDel(row.key);
        await rememberSent(row.key, row.hash);
        pushed += 1;
        continue;
      }
      const attempts = (row.attempts || 0) + 1;
      // 明确的协议错误（例如暂不支持的事件）重试也不会成功，达到次数后丢弃。
      if (attempts >= 5) {
        await outboxDel(row.key);
      } else {
        await outboxPut({ ...row, attempts, lastError: (result && result.error) || '未知错误' });
      }
      failed += 1;
    }

    const pending = await countOutbox();
    patchLink({ pending, lastSyncAt: pushed ? Date.now() : link.lastSyncAt });
    // 刚推上去的内容也应立刻出现在「库」页。
    if (pushed) scheduleLibrarySync(800);
    return { pushed, failed, pending };
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

/** 手动「立即同步」：跳过去重，强制入队并推送。 */
export async function syncNow(state = store.get()) {
  const queued = await queueSnapshot(state, { force: true });
  const result = await flushOutbox({ force: true });
  return { ...result, queued };
}

// ---------------------------------------------------------------------------
// 桌面库镜像（只读）
// ---------------------------------------------------------------------------

let librarySyncPromise = null;
let librarySyncTimer = null;

async function fetchLibraryItems(conn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}/v1/library/items`, {
      headers: { authorization: `Bearer ${conn.token}` },
      cache: 'no-store',
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: Number(data.total) || (Array.isArray(data.items) ? data.items.length : 0),
      truncated: Boolean(data.truncated),
      serverTime: Number(data.serverTime) || Date.now()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(conn, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}${path}`, {
      headers: { authorization: `Bearer ${conn.token}` },
      cache: 'no-store',
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || `桌面端返回 HTTP ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLibraryChanges(conn, since) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `http://127.0.0.1:${conn.port}/v1/library/changes?since=${Math.max(0, Math.floor(since))}`,
      {
        headers: { authorization: `Bearer ${conn.token}` },
        cache: 'no-store',
        signal: controller.signal
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return {
      full: Boolean(data.full),
      items: Array.isArray(data.items) ? data.items : [],
      deleted: Array.isArray(data.deleted) ? data.deleted : [],
      serverTime: Number(data.serverTime) || Date.now()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(conn, path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.token}`
      },
      cache: 'no-store',
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      return { ...data, ok: false, conflict: true };
    }
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || `桌面端返回 HTTP ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** 读取单条桌面库详情（完整总结/笔记，不含字幕正文）。 */
export async function fetchLibraryDetail(uid) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  return getJson(conn, `/v1/library/item?uid=${encodeURIComponent(uid)}`);
}

/** 回写总结；带 baseUpdatedAt 做乐观并发，冲突时返回 conflict。 */
export async function saveLibrarySummary(uid, content, baseUpdatedAt = 0, model = 'plugin') {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const data = await postJson(conn, '/v1/library/summary', {
    uid,
    content,
    model,
    baseUpdatedAt
  });
  if (data.ok) scheduleLibrarySync(600);
  return data;
}

/** 回写笔记；空内容表示删除笔记。 */
export async function saveLibraryNote(uid, content, baseUpdatedAt = 0) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const data = await postJson(conn, '/v1/library/note', {
    uid,
    content,
    baseUpdatedAt
  });
  if (data.ok) scheduleLibrarySync(600);
  return data;
}

/** 读取桌面端共享设置快照（可含 Key）。 */
export async function fetchSharedSettings(includeSecrets = true) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `http://127.0.0.1:${conn.port}/v1/settings/shared?includeSecrets=${includeSecrets ? '1' : '0'}`,
      {
        headers: { authorization: `Bearer ${conn.token}` },
        cache: 'no-store',
        signal: controller.signal
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.settings) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return data.settings;
  } finally {
    clearTimeout(timer);
  }
}

/** 拉取桌面端的桥接对话（插件写入过的会话）。 */
export async function fetchBridgeChats() {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}/v1/chat/export`, {
      headers: { authorization: `Bearer ${conn.token}` },
      cache: 'no-store',
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return Array.isArray(data.conversations) ? data.conversations : [];
  } finally {
    clearTimeout(timer);
  }
}

/** 用插件设置覆盖桌面端共享设置。 */
export async function pushSharedSettings(settings) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}/v1/settings/shared`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.token}`
      },
      cache: 'no-store',
      body: JSON.stringify({ settings }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** 回写标签（整组替换）。 */
export async function saveLibraryTags(uid, tags) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const data = await postJson(conn, '/v1/library/tags', { uid, tags });
  if (data.ok) scheduleLibrarySync(600);
  return data;
}

/** 回写合集（整组替换）。 */
export async function saveLibraryCollections(uid, collections) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const data = await postJson(conn, '/v1/library/collections', { uid, collections });
  if (data.ok) scheduleLibrarySync(600);
  return data;
}

/** 拉取桌面库列表并写入本地镜像；离线时保留缓存。 */
export async function syncLibrary() {
  if (librarySyncPromise) return librarySyncPromise;
  librarySyncPromise = (async () => {
    const conn = await ensureLink(false);
    if (!conn) {
      const cached = await libraryAll();
      store.set({
        desktopLibrary: {
          items: cached,
          total: cached.length,
          syncedAt: link.librarySyncedAt,
          offline: true,
          error: link.error || '未连接桌面端'
        }
      });
      return { ok: false, items: cached.length, error: link.error || '未连接桌面端' };
    }

    try {
      const meta = await readMeta();
      // 有游标时先走增量；桌面端要求 full（首次/游标过旧）再全量。
      if (meta.librarySince > 0) {
        const changes = await fetchLibraryChanges(conn, meta.librarySince);
        if (!changes.full) {
          if (changes.items.length) {
            await libraryPutAll(
              changes.items.map((item) => ({ ...item, cachedAt: Date.now() }))
            );
          }
          if (changes.deleted.length) await libraryDeleteMany(changes.deleted);
          const all = await libraryAll();
          const syncedAt = changes.serverTime;
          await writeMeta({ librarySince: syncedAt });
          patchLink({
            librarySyncedAt: syncedAt,
            library: {
              videos: all.length,
              segments: Number((link.library && link.library.segments) || 0)
            }
          });
          store.set({
            desktopLibrary: {
              items: all,
              total: all.length,
              syncedAt,
              offline: false,
              error: ''
            }
          });
          return {
            ok: true,
            incremental: true,
            items: all.length,
            changed: changes.items.length,
            deleted: changes.deleted.length
          };
        }
      }

      const snapshot = await fetchLibraryItems(conn);
      const stamped = snapshot.items.map((item) => ({ ...item, cachedAt: Date.now() }));
      // 未被 500 条上限截断时做全量替换，桌面端删除的条目才会从镜像消失。
      if (snapshot.truncated) await libraryPutAll(stamped);
      else await libraryReplaceAll(stamped);
      const syncedAt = snapshot.serverTime || Date.now();
      await writeMeta({ librarySince: syncedAt });
      patchLink({
        librarySyncedAt: syncedAt,
        library: {
          videos: snapshot.total || stamped.length,
          segments: Number((link.library && link.library.segments) || 0)
        }
      });
      store.set({
        desktopLibrary: {
          items: stamped,
          total: snapshot.total || stamped.length,
          syncedAt,
          offline: false,
          truncated: snapshot.truncated,
          error: ''
        }
      });
      return { ok: true, items: stamped.length, total: snapshot.total };
    } catch (err) {
      const cached = await libraryAll();
      const message = (err && err.message) || String(err);
      store.set({
        desktopLibrary: {
          items: cached,
          total: cached.length,
          syncedAt: link.librarySyncedAt,
          offline: true,
          error: message
        }
      });
      return { ok: false, items: cached.length, error: message };
    }
  })().finally(() => {
    librarySyncPromise = null;
  });
  return librarySyncPromise;
}

function scheduleLibrarySync(delay = 1200) {
  if (librarySyncTimer) clearTimeout(librarySyncTimer);
  librarySyncTimer = setTimeout(() => {
    librarySyncTimer = null;
    syncLibrary().catch(() => {});
  }, delay);
}

/** 只读缓存；面板先显示旧数据，再后台刷新。 */
export async function loadCachedLibrary() {
  const items = await libraryAll();
  store.set({
    desktopLibrary: {
      items,
      total: items.length,
      syncedAt: link.librarySyncedAt,
      offline: link.state !== 'connected',
      error: ''
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// 下行长轮询
// ---------------------------------------------------------------------------

async function pullOnce(conn, since, waitMs) {
  const controller = new AbortController();
  pollAbort = controller;
  const timer = setTimeout(() => controller.abort(), waitMs + 8000);
  try {
    const response = await fetch(
      `http://127.0.0.1:${conn.port}/v1/pull?since=${since}&wait=${waitMs}`,
      {
        headers: { authorization: `Bearer ${conn.token}` },
        cache: 'no-store',
        signal: controller.signal
      }
    );
    if (response.status === 401) {
      const error = new Error('Token 失效');
      error.code = 'unauthorized';
      throw error;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    if (pollAbort === controller) pollAbort = null;
  }
}

async function handleRemoteEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  let libraryChanged = false;
  for (const event of events) {
    if (event && event.type === 'library.changed') libraryChanged = true;
  }
  if (libraryChanged) {
    patchLink({ lastRemoteChangeAt: Date.now() });
    const conn = link.state === 'connected' ? link : await ensureLink(false);
    if (conn) {
      const health = await fetchHealth(link);
      if (health && health.library) patchLink({ library: health.library });
      scheduleLibrarySync();
    }
  }
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  let backoff = 1000;
  try {
    while (polling) {
      const conn = await ensureLink(false);
      if (!conn) {
        await sleep(backoff);
        backoff = Math.min(30000, backoff * 2);
        continue;
      }
      // 桌面端可能是在面板打开之后才启动：连上后先把离线队列补传。
      await flushOutbox().catch(() => {});
      if (Number(conn.protocol) < 2) {
        await sleep(30000);
        continue;
      }
      try {
        const meta = await readMeta();
        // 桌面端重启过：从 -1 重新握手，避免旧游标把新事件挡掉。
        const since =
          meta.instanceId && conn.instanceId && meta.instanceId !== conn.instanceId
            ? -1
            : meta.cursor;
        const data = await pullOnce(conn, since, 25000);
        backoff = 1000;
        if (!data || !data.ok) {
          await sleep(backoff);
          continue;
        }
        const cursor = Number.isFinite(Number(data.cursor)) ? Number(data.cursor) : 0;
        const instanceId = String(data.instanceId || conn.instanceId || '');
        await writeMeta({ cursor, instanceId });
        if (data.reset) {
          // 服务端缓冲已经滚掉旧事件；M2 会在这里触发一次全量同步。
          patchLink({ lastRemoteChangeAt: Date.now() });
        }
        await handleRemoteEvents(data.events);
      } catch (err) {
        if (err && err.code === 'unauthorized') {
          patchLink({ state: 'offline', token: '', error: 'Token 失效，重新发现中' });
          await ensureLink(true);
        }
        await sleep(backoff);
        backoff = Math.min(30000, backoff * 2);
      }
    }
  } finally {
    polling = false;
  }
}

export function stopPolling() {
  polling = false;
  if (pollAbort) {
    try {
      pollAbort.abort();
    } catch (err) {
      /* ignore */
    }
    pollAbort = null;
  }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

let started = false;

export async function initDesktopLink() {
  if (started) return linkStatus();
  started = true;

  try {
    if (!store.get().settings) await loadSettings();
  } catch (err) {
    /* 设置加载失败时仍然尝试连接，使用默认端口 */
  }

  const settings = store.get().settings || {};
  const cfg = settings.desktop || {};
  if (cfg.enabled !== false) {
    const conn = await ensureLink(true);
    if (conn) {
      await flushOutbox();
      const health = await fetchHealth(link);
      if (health && health.library) patchLink({ library: health.library });
    }
    // 先显示本地缓存，再后台刷新；没有桌面端时也能看上次镜像。
    await loadCachedLibrary().catch(() => {});
    void syncLibrary().catch(() => {});
    // 只有非内嵌侧边栏维持下行轮询；内嵌面板仍可自动上报，避免同一浏览器开两条长连接。
    if (!isEmbeddedPanel()) void pollLoop();
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      ensureLink(false)
        .then((conn) => (conn ? flushOutbox() : null))
        .catch(() => {});
    }
  };
  try {
    document.addEventListener('visibilitychange', onVisible);
  } catch (err) {
    /* ignore */
  }

  return linkStatus();
}
