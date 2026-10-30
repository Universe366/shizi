// 桌面 AI 委托：插件在桌面端可用时，把总结/对话交给桌面端执行。
//
// 好处：提示词、联网工具、官方分段、用量与桌面端天然一致；插件不用再维护
// 第二套模型配置。桌面端不可用时由 panel-ai 回退到本地 Stream。

import { ensureLink, linkStatus, onLinkChange } from './desktop-link.js';
import { Stream } from './bridge.js';
import { store } from './store.js';

let probeCache = { at: 0, ready: false, reason: '', platform: null, platforms: [], asr: null };
let probing = null;

function rpcUrl(conn) {
  return `http://127.0.0.1:${conn.port}/v1/rpc`;
}

function headers(conn) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${conn.token}`
  };
}

/** 探查桌面端 AI 是否真的可用；结果缓存 30 秒（失败缓存 8 秒）。 */
export async function probeDesktopAi(force = false) {
  const ttl = probeCache.ready ? 30000 : 8000;
  if (!force && probeCache.at && Date.now() - probeCache.at < ttl) return probeCache;

  // 不要让一次对话/总结卡在 10 个端口的发现上：连接由 desktop-link 的后台
  // 轮询负责，这里只在「已经连上」时问能力。
  const current = linkStatus();
  const conn = current && current.state === 'connected' ? current : null;
  if (!conn) {
    probeCache = {
      at: Date.now(),
      ready: false,
      reason: '未连接桌面端',
      platform: null,
      platforms: [],
      asr: null
    };
    return probeCache;
  }
  if (!Array.isArray(conn.capabilities) || !conn.capabilities.includes('ai.chat')) {
    probeCache = {
      at: Date.now(),
      ready: false,
      reason: '桌面端版本过旧，不支持 AI 委托',
      platform: null,
      platforms: [],
      asr: null
    };
    return probeCache;
  }
  if (probing) return probing;

  probing = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(rpcUrl(conn), {
        method: 'POST',
        headers: headers(conn),
        cache: 'no-store',
        body: JSON.stringify({
          protocol: 2,
          method: 'settings.read',
          params: {}
        }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      const ai = (data && data.data && data.data.ai) || data.ai || null;
      probeCache = {
        at: Date.now(),
        ready: Boolean(response.ok && data.ok && ai && ai.ready),
        reason: (ai && ai.reason) || (data && data.error) || '',
        platform: (ai && ai.platform) || null,
        platforms: (ai && ai.platforms) || [],
        asr: (ai && ai.asr) || null
      };
    } catch (err) {
      probeCache = {
        at: Date.now(),
        ready: false,
        reason: (err && err.message) || '桌面端 AI 无响应',
        platform: null,
        platforms: [],
        asr: null
      };
    } finally {
      clearTimeout(timer);
    }
    store.set({
      desktopAiReady: probeCache.ready,
      desktopAsrReady: !!(probeCache.asr && probeCache.asr.ready)
    });
    return probeCache;
  })().finally(() => {
    probing = null;
  });

  return probing;
}

/** 执行策略：auto 优先桌面，local 只用本地，desktop 强制尝试桌面（失败仍回退）。 */
export function desktopAiAllowed(settings) {
  const cfg = (settings && settings.desktop) || {};
  if (cfg.executionMode === 'local') return false;
  if (cfg.useDesktopAi === false) return false;
  return true;
}

export function desktopAiRequired(settings) {
  const cfg = (settings && settings.desktop) || {};
  return cfg.executionMode === 'desktop';
}

/** 与本地 Stream 相同的接口，panel-ai 只换构造函数即可。 */
export class AutoStream {
  constructor() {
    this.route = '';
    this.params = {};
    this.callbacks = {};
    this.current = null;
    this.received = false;
    this.closed = false;
    this.rid = null;
  }

  start(route, params, callbacks = {}) {
    this.route = route;
    this.params = params;
    this.callbacks = callbacks;
    this.received = false;
    this.closed = false;
    this.current = new DesktopStream();
    this.rid = this.current.start(route, params, this.wrap(callbacks, false));
    return this.rid;
  }

  wrap(callbacks, fallback) {
    return {
      ...callbacks,
      onDelta: (text) => {
        this.received = true;
        if (callbacks.onDelta) callbacks.onDelta(text);
      },
      onEnd: (event) => {
        if (callbacks.onEnd) callbacks.onEnd(event);
      },
      onError: (payload) => {
        // 桌面端在输出任何字之前失败：自动换本地流，参数与回调完全一致。
        if (!fallback && !this.received && !this.closed) {
          this.current = new Stream();
          this.current.start(this.route, this.params, this.wrap(callbacks, true));
          return;
        }
        if (callbacks.onError) callbacks.onError(payload);
      }
    };
  }

  cancel() {
    this.closed = true;
    if (this.current && typeof this.current.cancel === 'function') this.current.cancel();
  }

  close() {
    this.closed = true;
    if (this.current && typeof this.current.close === 'function') this.current.close();
  }
}

export class DesktopStream {
  constructor() {
    this.rid = null;
    this.closed = false;
    this.ended = false;
    this.controller = null;
    this.callbacks = {};
    this.received = false;
  }

  start(route, params = {}, callbacks = {}) {
    this.rid = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.closed = false;
    this.ended = false;
    this.received = false;
    this.callbacks = callbacks;
    this.controller = new AbortController();
    this.run(route, params).catch((err) => this.fail(err));
    return this.rid;
  }

  async run(route, params) {
    const conn = await ensureLink(false);
    if (!conn) throw new Error('桌面端未连接');

    const isSummary = route === 'ai.summarize';
    const body = {
      protocol: 2,
      method: isSummary ? 'ai.summarize' : 'ai.chat',
      stream: true,
      params: {
        video: params.video || null,
        lines: Array.isArray(params.lines) ? params.lines : [],
        messages: Array.isArray(params.messages) ? params.messages : [],
        // 总结默认联网（与桌面端一致）；对话由调用方显式传 web。
        web: isSummary ? params.web !== false : params.web === true,
        includeTranscript: isSummary ? true : params.includeTranscript !== false
      }
    };

    const response = await fetch(rpcUrl(conn), {
      method: 'POST',
      headers: headers(conn),
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: this.controller.signal
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) this.handle(line);
        index = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) this.handle(buffer.trim());
    if (!this.ended && !this.closed) {
      throw new Error('桌面端连接中断');
    }
  }

  async sendApproval(id, allow) {
    try {
      const conn = await ensureLink(false);
      if (!conn) return;
      await fetch(`http://127.0.0.1:${conn.port}/v1/rpc/approval`, {
        method: 'POST',
        headers: headers(conn),
        cache: 'no-store',
        body: JSON.stringify({ id, allow })
      });
    } catch (err) {
      /* 审批失败由桌面端超时拒绝 */
    }
  }

  handle(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (err) {
      return;
    }
    if (!event || !event.type) return;
    if (event.type === 'delta') {
      this.received = true;
      if (this.callbacks.onDelta) this.callbacks.onDelta(String(event.text || ''));
      return;
    }
    if (event.type === 'reasoning') {
      if (this.callbacks.onReasoning) this.callbacks.onReasoning(String(event.text || ''));
      return;
    }
    if (event.type === 'status') {
      if (this.callbacks.onLog) this.callbacks.onLog('info', String(event.text || ''));
      return;
    }
    if (event.type === 'tool') {
      if (this.callbacks.onTool) this.callbacks.onTool(event.event || {});
      return;
    }
    if (event.type === 'approval') {
      const decide = this.callbacks.onApproval
        ? this.callbacks.onApproval(event)
        : Promise.resolve(false);
      Promise.resolve(decide)
        .then((allow) => this.sendApproval(event.id, allow === true))
        .catch(() => this.sendApproval(event.id, false));
      return;
    }
    if (event.type === 'done') {
      this.ended = true;
      // 非流式 provider 可能只在 done 里给全文；补一次 delta，避免总结为空。
      if (!this.received && event.text && this.callbacks.onDelta) {
        this.received = true;
        this.callbacks.onDelta(String(event.text));
      }
      if (this.callbacks.onEnd) this.callbacks.onEnd(event);
      return;
    }
    if (event.type === 'error') {
      this.ended = true;
      if (this.callbacks.onError) {
        this.callbacks.onError({
          kind: 'desktop',
          title: '桌面端生成失败',
          detail: String(event.error || '未知错误'),
          action: '可在 设置 → 桌面端 检查连接；插件本地 AI 仍可单独使用。'
        });
      }
    }
  }

  fail(error) {
    if (this.closed || this.ended) return;
    if (error && error.name === 'AbortError') {
      this.ended = true;
      if (this.callbacks.onError) {
        this.callbacks.onError({ kind: 'aborted', title: '已终止', detail: '已保留已生成的部分' });
      }
      return;
    }
    this.ended = true;
    if (this.callbacks.onError) {
      this.callbacks.onError({
        kind: 'desktop',
        title: '桌面端不可用',
        detail: (error && error.message) || String(error),
        action: '可在 设置 → 桌面端 检查连接；插件本地 AI 仍可单独使用。'
      });
    }
  }

  cancel() {
    this.closed = true;
    try {
      if (this.controller) this.controller.abort();
    } catch (err) {
      /* ignore */
    }
    if (!this.ended && this.callbacks.onError) {
      this.ended = true;
      this.callbacks.onError({ kind: 'aborted', title: '已终止', detail: '已保留已生成的部分' });
    }
  }

  close() {
    this.closed = true;
    try {
      if (this.controller) this.controller.abort();
    } catch (err) {
      /* ignore */
    }
  }
}

// 桌面端断开时立刻让 UI 的「桌面端生成」标记失效，不等 30 秒缓存过期。
onLinkChange((status) => {
  if (!status || status.state !== 'connected') {
    probeCache = {
      at: Date.now(),
      ready: false,
      reason: '未连接桌面端',
      platform: null,
      platforms: [],
      asr: null
    };
    if (store.get().desktopAiReady || store.get().desktopAsrReady) {
      store.set({ desktopAiReady: false, desktopAsrReady: false });
    }
    return;
  }
  // 刚连上：清掉「未连接」缓存并主动探一次，别让第一次总结还走本地。
  if (!probeCache.ready || !(probeCache.asr && probeCache.asr.ready)) {
    probeCache = { ...probeCache, at: 0 };
    probeDesktopAi().catch(() => {});
  }
});

/** 把插件对话整段同步到桌面 chat.db（仅覆盖该 conversationKey 的桥接会话）。 */
export async function syncChatConversation(key, payload) {
  const conn = await ensureLink(false);
  if (!conn) return { ok: false, error: '未连接桌面端' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}/v1/chat/sync`, {
      method: 'POST',
      headers: headers(conn),
      cache: 'no-store',
      body: JSON.stringify({
        key,
        videoKey: payload.videoKey || '',
        videoTitle: payload.videoTitle || '',
        messages: payload.messages || []
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** 用桌面端校对链路获取修改建议；返回 { suggestions }。 */
export async function optimizeViaDesktop(lines) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await fetch(rpcUrl(conn), {
      method: 'POST',
      headers: headers(conn),
      cache: 'no-store',
      body: JSON.stringify({
        protocol: 2,
        method: 'optimize.lines',
        params: {
          lines: (Array.isArray(lines) ? lines : []).map((line) => ({
            start: Number(line.from != null ? line.from : line.start) || 0,
            end: Number(line.to != null ? line.to : line.end) || 0,
            text: String(line.text || '')
          }))
        }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.data) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return data.data;
  } finally {
    clearTimeout(timer);
  }
}

/** 用桌面端翻译链路翻译一批字幕；返回 { lines, language }。 */
export async function translateViaDesktop(lines, target) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await fetch(rpcUrl(conn), {
      method: 'POST',
      headers: headers(conn),
      cache: 'no-store',
      body: JSON.stringify({
        protocol: 2,
        method: 'translate.lines',
        params: {
          target: String(target || ''),
          lines: (Array.isArray(lines) ? lines : []).map((line) => ({
            start: Number(line.from != null ? line.from : line.start) || 0,
            end: Number(line.to != null ? line.to : line.end) || 0,
            text: String(line.text || '')
          }))
        }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.data) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return data.data;
  } finally {
    clearTimeout(timer);
  }
}

/** 用桌面端导出引擎生成文件内容；与桌面端字节一致。 */
export async function exportViaDesktop(params) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(rpcUrl(conn), {
      method: 'POST',
      headers: headers(conn),
      cache: 'no-store',
      body: JSON.stringify({
        protocol: 2,
        method: 'export.build',
        params: {
          video: params.video || null,
          lines: Array.isArray(params.lines) ? params.lines : [],
          track: params.track || null,
          summary: String(params.summary || ''),
          format: String(params.format || 'srt'),
          template: String(params.template || 'timestamped'),
          includeTimestamps: params.includeTimestamps !== false,
          filenamePattern: String(params.filenamePattern || '{title}'),
          assFontSize: Number(params.assFontSize) || 28,
          estimateTimestamps: params.estimateTimestamps !== false,
          translatedLines: params.translatedLines || null,
          translationLanguage: params.translationLanguage || ''
        }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.data) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return data.data;
  } finally {
    clearTimeout(timer);
  }
}

/** 用桌面端 TTS 朗读文字；返回 { dataUrl, mime, engine }。 */
export async function speakViaDesktop(text) {
  const content = String(text || '').slice(0, 5000);
  if (!content.trim()) throw new Error('没有可朗读的文字');
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(rpcUrl(conn), {
      method: 'POST',
      headers: headers(conn),
      cache: 'no-store',
      body: JSON.stringify({
        protocol: 2,
        method: 'tts.speak',
        params: { text: content }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `桌面端返回 HTTP ${response.status}`);
    }
    return data.data || null;
  } finally {
    clearTimeout(timer);
  }
}

/** 桌面端本地 Whisper 是否可用（连接 + 平台就绪）。 */
export function desktopAsrReady() {
  const state = desktopAiState();
  return {
    ready: !!(state.connected && state.asr && state.asr.ready),
    reason: (state.asr && state.asr.reason) || '桌面端本地 Whisper 不可用'
  };
}

/** 把一片 WAV/M4A 交给桌面本地 Whisper 识别，返回与在线 ASR 相同的结构。 */
export async function transcribeViaDesktop(bytes, opts = {}) {
  const conn = await ensureLink(false);
  if (!conn) throw new Error('未连接桌面端');
  const query = new URLSearchParams({
    duration: String(Math.max(0, Number(opts.duration) || 0)),
    format: String(opts.format || 'wav'),
    language: String(opts.language || 'zh'),
    title: String(opts.title || ''),
    url: String(opts.url || '')
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(opts.timeoutMs) || 180000);
  try {
    const response = await fetch(`http://127.0.0.1:${conn.port}/v1/asr?${query}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${conn.token}`,
        'content-type': 'application/octet-stream'
      },
      body: bytes
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || `桌面端返回 HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function desktopAiState() {
  const connected = linkStatus().state === 'connected';
  return {
    ...probeCache,
    ready: probeCache.ready === true && connected,
    connected
  };
}
