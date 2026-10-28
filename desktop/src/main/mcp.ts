import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { session } from 'electron';
import { refreshMcpOAuth } from './mcpOAuth';
import type {
  McpElicitationAction,
  McpElicitationRequest,
  McpPrompt,
  McpPromptOption,
  McpResource,
  McpResourceOption,
  McpServer,
  McpTool,
  McpToolOption
} from '../shared/types';

const LATEST_PROTOCOL_VERSION = '2025-06-18';
const FALLBACK_PROTOCOL_VERSION = '2024-11-05';
const sessionIds = new Map<string, string>();
const protocolVersions = new Map<string, string>();
let seq = 0;
const nextId = () => ++seq;

export interface McpProgress {
  progress: number;
  total: number;
  message: string;
}

type McpNotificationSink = (
  server: McpServer,
  method: string,
  params: Record<string, unknown>
) => void;

let notificationSink: McpNotificationSink | null = null;
let serverRequestSink: ((request: McpElicitationRequest) => void) | null = null;
const progressHandlers = new Map<string, (progress: McpProgress) => void>();
const sseEndpoints = new Map<string, string>();
let serverRequestSeq = 0;
let httpDisabled = false;

interface PendingElicitation {
  server: McpServer;
  jsonrpcId: number | string;
  timer: NodeJS.Timeout;
  resolve: (result: Record<string, unknown>) => void;
}

const pendingElicitations = new Map<string, PendingElicitation>();

export function setMcpServerRequestSink(
  sink: ((request: McpElicitationRequest) => void) | null
): void {
  serverRequestSink = sink;
}

/** 主进程注册一次：把服务端主动通知转发给渲染层。 */
export function setMcpNotificationSink(sink: McpNotificationSink | null): void {
  notificationSink = sink;
}

function handleIncomingMessage(server: McpServer, message: JsonRpcResponse): void {
  const method = typeof message.method === 'string' ? message.method : '';
  if (!method) return;
  if (typeof message.id === 'number' || typeof message.id === 'string') {
    void handleServerRequest(server, message);
    return;
  }
  const params =
    message.params && typeof message.params === 'object'
      ? (message.params as Record<string, unknown>)
      : {};
  try {
    notificationSink?.(server, method, params);
  } catch {
    // 通知展示失败不影响协议
  }
  if (method === 'notifications/progress') {
    const token = String(params.progressToken || '');
    const handler = progressHandlers.get(token);
    if (handler) {
      handler({
        progress: Number(params.progress) || 0,
        total: Number(params.total) || 0,
        message: String(params.message || '')
      });
    }
  }
}

/** 把 JSON-RPC 响应写回服务端（stdio / HTTP / 老式 SSE 端点）。 */
async function sendServerResponse(
  server: McpServer,
  id: number | string,
  result?: unknown,
  error?: { code: number; message: string }
): Promise<void> {
  const body: Record<string, unknown> = { jsonrpc: '2.0', id };
  if (error) body.error = error;
  else body.result = result ?? {};
  try {
    if (server.transport === 'stdio') {
      const client = startStdio(server);
      client.child.stdin.write(`${JSON.stringify(body)}\n`);
      return;
    }
    if (server.transport === 'sse') {
      const endpoint = sseEndpoints.get(serverKey(server));
      if (!endpoint) return;
      await session.defaultSession.fetch(endpoint, {
        method: 'POST',
        headers: headersFor(server),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
      return;
    }
    await postHttp(server, body, 15000);
  } catch {
    // 服务端已断开时忽略
  }
}

async function handleServerRequest(server: McpServer, message: JsonRpcResponse): Promise<void> {
  const id = message.id;
  if (typeof id !== 'number' && typeof id !== 'string') return;
  const method = String(message.method || '');
  const params =
    message.params && typeof message.params === 'object'
      ? (message.params as Record<string, unknown>)
      : {};

  if (method === 'ping') {
    await sendServerResponse(server, id, {});
    return;
  }
  if (method === 'roots/list') {
    await sendServerResponse(server, id, { roots: [] });
    return;
  }
  if (method === 'elicitation/create') {
    if (!serverRequestSink) {
      await sendServerResponse(server, id, { action: 'decline' });
      return;
    }
    const requestId = `elicitation-${server.id}-${++serverRequestSeq}`;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        pendingElicitations.delete(requestId);
        void sendServerResponse(server, id, { action: 'cancel' });
        resolve();
      }, 300_000);
      pendingElicitations.set(requestId, {
        server,
        jsonrpcId: id,
        timer,
        resolve: (result) => {
          clearTimeout(timer);
          pendingElicitations.delete(requestId);
          void sendServerResponse(server, id, result).finally(resolve);
        }
      });
      serverRequestSink?.({
        requestId,
        serverId: server.id,
        serverName: server.name,
        message: String(params.message || '服务端请求补充信息'),
        requestedSchema: params.requestedSchema ?? {}
      });
    });
    return;
  }
  if (method === 'sampling/createMessage') {
    await sendServerResponse(server, id, undefined, {
      code: -32601,
      message: '客户端未启用 sampling'
    });
    return;
  }
  await sendServerResponse(server, id, undefined, {
    code: -32601,
    message: `不支持的方法：${method}`
  });
}

export function replyMcpElicitation(
  requestId: string,
  action: McpElicitationAction,
  content?: Record<string, unknown>
): boolean {
  const pending = pendingElicitations.get(requestId);
  if (!pending) return false;
  pending.resolve(action === 'accept' ? { action, content: content || {} } : { action });
  return true;
}

function cancelElicitations(server?: McpServer): void {
  for (const [requestId, pending] of pendingElicitations) {
    if (server && pending.server.id !== server.id) continue;
    pending.resolve({ action: 'cancel' });
    pendingElicitations.delete(requestId);
  }
}

function serverKey(server: McpServer): string {
  return `${server.id}|${server.url}`;
}

function headersFor(server: McpServer): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json'
  };
  const token = String(server.token || '').trim();
  const oauthToken = String(server.oauth?.accessToken || '').trim();
  if (token) headers.authorization = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  else if (oauthToken) headers.authorization = `Bearer ${oauthToken}`;
  for (const [key, value] of Object.entries(server.headers || {})) {
    if (key && value) headers[key] = String(value);
  }
  const key = serverKey(server);
  const sessionId = sessionIds.get(key);
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const protocolVersion = protocolVersions.get(key);
  if (protocolVersion && server.transport !== 'stdio') {
    headers['mcp-protocol-version'] = protocolVersion;
  }
  return headers;
}

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse {
  id?: number | null;
  result?: unknown;
  error?: JsonRpcError;
  method?: string;
  params?: Record<string, unknown>;
}

interface McpToolRow {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  input_schema?: unknown;
}

interface McpContentItem {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri?: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

type JsonRpcResult = {
  tools?: McpToolRow[];
  content?: McpContentItem[];
  [key: string]: unknown;
};

function parseRpc(text: string, expectId: number | null): JsonRpcResponse | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcResponse[];
      if (expectId == null) return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed;
      if (Array.isArray(parsed)) {
        return parsed.find((item) => item && item.id === expectId) || parsed[0];
      }
      return parsed;
    } catch {
      // 继续按 SSE 解析
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const match = /^data:\s*(.*)$/.exec(line);
    if (!match || !match[1]) continue;
    try {
      const parsed = JSON.parse(match[1]) as JsonRpcResponse;
      if (
        expectId == null ||
        (parsed && (parsed.id === expectId || parsed.result || parsed.error))
      ) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

async function postHttp(
  server: McpServer,
  body: unknown,
  timeoutMs = 40000,
  signal?: AbortSignal
): Promise<Response> {
  const combined = signal
    ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
    : AbortSignal.timeout(timeoutMs);
  if (!server.url.trim()) throw new Error('MCP 服务地址为空');
  if (
    server.oauth?.refreshToken &&
    server.oauth.expiresAt &&
    server.oauth.expiresAt - 60_000 < Date.now()
  ) {
    server.oauth = await refreshMcpOAuth(server.oauth);
  }
  const send = () =>
    session.defaultSession.fetch(server.url.trim(), {
      method: 'POST',
      headers: headersFor(server),
      body: JSON.stringify(body),
      signal: combined
    });
  let response = await send();
  if (response.status === 401 && server.oauth?.refreshToken) {
    server.oauth = await refreshMcpOAuth(server.oauth);
    response = await send();
  }
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId) sessionIds.set(serverKey(server), sessionId);
  return response;
}

async function rpcHttp(
  server: McpServer,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 40000,
  signal?: AbortSignal
): Promise<JsonRpcResult | null> {
  const response = await postHttp(
    server,
    {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params })
    },
    timeoutMs,
    signal
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`MCP 服务返回 HTTP ${response.status}：${text.slice(0, 200)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  let message: JsonRpcResponse | null = null;
  if (contentType.includes('text/event-stream') && response.body) {
    message = await readSseResponse(server, response.body, id);
  } else {
    message = parseRpc(await response.text(), id);
  }
  if (!message) throw new Error('MCP 响应无法解析');
  if (message.error) {
    throw new Error(`MCP 调用出错（${message.error.code ?? '?'}）：${message.error.message || ''}`);
  }
  return (message.result as JsonRpcResult | undefined) ?? null;
}

/** 读取 POST 返回的 SSE 流：一边派发通知（progress 等），一边等本次请求的响应。 */
async function readSseResponse(
  server: McpServer,
  body: ReadableStream<Uint8Array>,
  expectId: number
): Promise<JsonRpcResponse | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = raw
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) {
          try {
            const message = JSON.parse(data) as JsonRpcResponse;
            if (message && message.id === expectId) {
              await reader.cancel().catch(() => undefined);
              return message;
            }
            if (message && message.method) handleIncomingMessage(server, message);
          } catch {
            // 忽略无法解析的通知
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return null;
}

interface SseEvent {
  event: string;
  data: string;
}

async function rpcSse(
  server: McpServer,
  body: { jsonrpc: string; id?: number; method: string; params?: unknown },
  expectId: number | null,
  timeoutMs = 40000,
  signal?: AbortSignal
): Promise<JsonRpcResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await session.defaultSession.fetch(server.url.trim(), {
      method: 'GET',
      headers: { ...headersFor(server), accept: 'text/event-stream' },
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`MCP SSE 连接失败（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const nextEvent = async (): Promise<SseEvent | null> => {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          let event = 'message';
          const data: string[] = [];
          for (const line of raw.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          }
          if (data.length) return { event, data: data.join('\n') };
          continue;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    };

    let endpoint = '';
    for (let index = 0; index < 20; index += 1) {
      const event = await nextEvent();
      if (!event) break;
      const value = event.data.trim();
      if (event.event === 'endpoint' || /^(\/|https?:)/i.test(value)) {
        endpoint = value;
        break;
      }
    }
    if (!endpoint) throw new Error('MCP SSE 没有返回 endpoint');

    const target = new URL(endpoint, server.url.trim()).toString();
    sseEndpoints.set(serverKey(server), target);
    const posted = await session.defaultSession.fetch(target, {
      method: 'POST',
      headers: headersFor(server),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await posted.text();
    if (!posted.ok && posted.status !== 202) {
      throw new Error(`MCP SSE 消息提交失败（HTTP ${posted.status}）：${text.slice(0, 200)}`);
    }

    if (expectId == null) return null;

    let message = parseRpc(text, expectId);
    while (!message) {
      const event = await nextEvent();
      if (!event) break;
      if (event.event === 'message') message = parseRpc(event.data, expectId);
    }
    if (!message) throw new Error('MCP SSE 响应无法解析');
    if (message.error) {
      throw new Error(
        `MCP 调用出错（${message.error.code ?? '?'}）：${message.error.message || ''}`
      );
    }
    return (message.result as JsonRpcResult | undefined) ?? null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.abort();
  }
}

async function rpc(
  server: McpServer,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 40000,
  signal?: AbortSignal
): Promise<JsonRpcResult | null> {
  if (server.transport === 'stdio') {
    return stdioRequest(server, method, params, timeoutMs, signal);
  }
  if (server.transport === 'sse') {
    return rpcSse(server, { jsonrpc: '2.0', id, method, params }, id, timeoutMs, signal);
  }
  return rpcHttp(server, method, params, id, timeoutMs, signal);
}

// ---------------------------------------------------------------------------
// stdio 传输：本地 MCP 服务（npx / uvx / node / python）通过 stdin/stdout 走
// 换行分隔的 JSON-RPC。进程由我们拉起，退出/禁用时负责回收。
// ---------------------------------------------------------------------------

interface StdioPending {
  resolve: (result: JsonRpcResult | null) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanup?: () => void;
}

interface StdioClient {
  server: McpServer;
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  seq: number;
  pending: Map<number, StdioPending>;
  initialized: boolean;
}

const stdioClients = new Map<string, StdioClient>();

function stdioKey(server: McpServer): string {
  return `${server.id}|${server.command || ''}|${(server.args || []).join(' ')}`;
}

function settleAll(client: StdioClient, error: Error): void {
  for (const pending of client.pending.values()) {
    clearTimeout(pending.timer);
    pending.cleanup?.();
    pending.reject(error);
  }
  client.pending.clear();
}

function handleStdioLine(client: StdioClient, line: string): void {
  const text = line.trim();
  if (!text) return;
  let message: JsonRpcResponse;
  try {
    message = JSON.parse(text) as JsonRpcResponse;
  } catch {
    return;
  }
  if (typeof message.id !== 'number') {
    handleIncomingMessage(client.server, message);
    return;
  }
  const pending = client.pending.get(message.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.cleanup?.();
  client.pending.delete(message.id);
  if (message.error) {
    pending.reject(
      new Error(`MCP 调用出错（${message.error.code ?? '?'}）：${message.error.message || ''}`)
    );
    return;
  }
  pending.resolve((message.result as JsonRpcResult | undefined) ?? null);
}

function startStdio(server: McpServer): StdioClient {
  const key = stdioKey(server);
  const existing = stdioClients.get(key);
  if (existing && existing.child.exitCode === null && !existing.child.killed) return existing;

  const command = String(server.command || '').trim();
  if (!command) throw new Error('stdio MCP 没有填写启动命令（例如 npx）');
  const child = spawn(command, [...(server.args || [])], {
    cwd: server.cwd || undefined,
    env: { ...process.env, ...(server.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32'
  });
  const client: StdioClient = {
    server,
    child,
    buffer: '',
    seq: 0,
    pending: new Map(),
    initialized: false
  };
  stdioClients.set(key, client);

  child.stdout.on('data', (chunk: Buffer) => {
    client.buffer += chunk.toString('utf8');
    let index = client.buffer.indexOf('\n');
    while (index >= 0) {
      const line = client.buffer.slice(0, index);
      client.buffer = client.buffer.slice(index + 1);
      handleStdioLine(client, line);
      index = client.buffer.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const text = String(chunk).trim();
    if (text) console.warn(`[mcp stdio:${server.name}]`, text.slice(0, 500));
  });
  const cleanup = () => {
    settleAll(client, new Error('MCP stdio 进程已退出'));
    stdioClients.delete(key);
  };
  child.on('exit', cleanup);
  child.on('error', (error) => {
    settleAll(client, error);
    stdioClients.delete(key);
  });
  return client;
}

function stdioRequest(
  server: McpServer,
  method: string,
  params: unknown,
  timeoutMs = 40000,
  signal?: AbortSignal
): Promise<JsonRpcResult | null> {
  const client = startStdio(server);
  const id = ++client.seq;
  if (signal?.aborted) return Promise.reject(new Error('已取消'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      client.pending.delete(id);
      reject(new Error('已取消'));
    };
    const timer = setTimeout(() => {
      client.pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`MCP stdio 超时（${Math.round(timeoutMs / 1000)} 秒）：${method}`));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    client.pending.set(id, {
      resolve,
      reject,
      timer,
      cleanup: () => signal?.removeEventListener('abort', onAbort)
    });
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params })
    });
    client.child.stdin.write(`${payload}\n`, (error) => {
      if (!error) return;
      clearTimeout(timer);
      client.pending.delete(id);
      reject(error);
    });
  });
}

function stdioNotify(server: McpServer, method: string, params?: unknown): void {
  try {
    const client = startStdio(server);
    client.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`
    );
  } catch {
    // 通知失败不影响后续调用
  }
}

/** 退出应用/禁用服务时回收所有 stdio 子进程，避免留下孤儿进程。 */
export function disposeMcpClients(): void {
  httpDisabled = true;
  cancelElicitations();
  sseEndpoints.clear();
  for (const controller of httpStreams.values()) {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }
  httpStreams.clear();
  for (const client of stdioClients.values()) {
    try {
      client.child.kill();
    } catch {
      // ignore
    }
  }
  stdioClients.clear();
}

async function notifyInitialized(server: McpServer): Promise<void> {
  try {
    if (server.transport === 'stdio') {
      stdioNotify(server, 'notifications/initialized');
      return;
    }
    if (server.transport === 'sse') {
      await rpcSse(server, { jsonrpc: '2.0', method: 'notifications/initialized' }, null, 10000);
    } else {
      await postHttp(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
    }
  } catch {
    // 通知失败不影响后续调用
  }
}

async function initialize(server: McpServer, protocolVersion: string): Promise<unknown> {
  return rpc(
    server,
    'initialize',
    {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'shizi', version: '1.0.0' }
    },
    nextId()
  );
}

/** 先按最新协议协商；老服务报错时退回 2024-11-05。 */
async function negotiateProtocol(server: McpServer): Promise<string> {
  try {
    const result = (await initialize(server, LATEST_PROTOCOL_VERSION)) as {
      protocolVersion?: unknown;
    } | null;
    return String(result?.protocolVersion || LATEST_PROTOCOL_VERSION);
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (!/protocol|version|400|406|415/i.test(message)) throw error;
    const result = (await initialize(server, FALLBACK_PROTOCOL_VERSION)) as {
      protocolVersion?: unknown;
    } | null;
    return String(result?.protocolVersion || FALLBACK_PROTOCOL_VERSION);
  }
}

async function ensureSession(server: McpServer): Promise<void> {
  const key = serverKey(server);
  if (server.transport === 'stdio') {
    const client = startStdio(server);
    if (client.initialized) return;
    protocolVersions.set(key, await negotiateProtocol(server));
    await notifyInitialized(server);
    client.initialized = true;
    return;
  }
  if (!sessionIds.has(key)) {
    protocolVersions.set(key, await negotiateProtocol(server));
    await notifyInitialized(server);
  }
  startHttpNotificationStream(server);
}

/** HTTP 服务的常驻通知流：尽力打开 GET SSE，不支持时静默放弃。 */
const httpStreams = new Map<string, AbortController>();
const httpAttempts = new Map<string, number>();

function startHttpNotificationStream(server: McpServer): void {
  if (server.transport !== 'http' || !server.url.trim()) return;
  const key = serverKey(server);
  if (httpStreams.has(key)) return;
  const controller = new AbortController();
  httpStreams.set(key, controller);
  let established = false;
  void (async () => {
    try {
      const streamHeaders: Record<string, string> = {
        ...headersFor(server),
        accept: 'text/event-stream'
      };
      delete streamHeaders['content-type'];
      const response = await session.defaultSession.fetch(server.url.trim(), {
        method: 'GET',
        headers: streamHeaders,
        signal: controller.signal
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
        return;
      }
      established = true;
      httpAttempts.set(key, 0);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = raw
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''))
            .join('\n');
          if (data) {
            try {
              const message = JSON.parse(data) as JsonRpcResponse;
              if (message?.method) handleIncomingMessage(server, message);
            } catch {
              // 忽略无法解析的通知
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // 服务端不支持 GET 通知流或连接中断：不影响正常请求
    } finally {
      if (httpStreams.get(key) === controller) httpStreams.delete(key);
      if (established && !controller.signal.aborted && !httpDisabled) {
        const attempt = (httpAttempts.get(key) || 0) + 1;
        httpAttempts.set(key, attempt);
        if (attempt <= 6) {
          const delay = Math.min(30_000, 3000 * attempt);
          setTimeout(() => {
            if (!httpDisabled) startHttpNotificationStream(server);
          }, delay);
        }
      }
    }
  })();
}

export async function listMcpTools(server: McpServer): Promise<McpTool[]> {
  await ensureSession(server);
  const result = await rpc(server, 'tools/list', {}, nextId());
  const rows = Array.isArray(result?.tools) ? result.tools : [];
  return rows
    .filter((item) => item && item.name)
    .map((item) => ({
      name: String(item.name),
      description: String(item.description || ''),
      inputSchema: item.inputSchema || item.input_schema
    }));
}

interface McpResourceRow {
  uri?: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface McpPromptRow {
  name?: string;
  description?: string;
  arguments?: Array<{ name?: string; description?: string; required?: boolean }>;
}

export async function listMcpResources(server: McpServer): Promise<McpResource[]> {
  await ensureSession(server);
  const result = await rpc(server, 'resources/list', {}, nextId());
  const rows = Array.isArray((result as { resources?: McpResourceRow[] })?.resources)
    ? ((result as { resources: McpResourceRow[] }).resources as McpResourceRow[])
    : [];
  return rows
    .filter((item) => item?.uri)
    .map((item) => ({
      uri: String(item.uri),
      name: String(item.name || item.uri),
      description: String(item.description || ''),
      mimeType: String(item.mimeType || '')
    }));
}

/** 读取一个资源；二进制资源用占位说明，不把 base64 塞进设置页。 */
/** 尽力向服务端声明订阅；不支持时静默忽略，由本地轮询兜底。 */
export async function subscribeMcpResource(server: McpServer, uri: string): Promise<void> {
  await ensureSession(server);
  try {
    await rpc(server, 'resources/subscribe', { uri }, nextId(), 15000);
  } catch {
    // 服务端不支持订阅时继续轮询
  }
}

export async function unsubscribeMcpResource(server: McpServer, uri: string): Promise<void> {
  try {
    await rpc(server, 'resources/unsubscribe', { uri }, nextId(), 15000);
  } catch {
    // ignore
  }
}

export async function readMcpResource(server: McpServer, uri: string): Promise<string> {
  await ensureSession(server);
  const result = (await rpc(server, 'resources/read', { uri }, nextId())) as {
    contents?: Array<{ text?: string; blob?: string; mimeType?: string }>;
  } | null;
  const rows = Array.isArray(result?.contents) ? result.contents : [];
  const text = rows
    .map((row) => {
      if (row?.text) return String(row.text);
      if (row?.blob) return `（二进制资源 ${row.mimeType || ''}，${row.blob.length} 字符 base64）`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
  return text.slice(0, 20000);
}

export async function listMcpPrompts(server: McpServer): Promise<McpPrompt[]> {
  await ensureSession(server);
  const result = await rpc(server, 'prompts/list', {}, nextId());
  const rows = Array.isArray((result as { prompts?: McpPromptRow[] })?.prompts)
    ? ((result as { prompts: McpPromptRow[] }).prompts as McpPromptRow[])
    : [];
  return rows
    .filter((item) => item?.name)
    .map((item) => ({
      name: String(item.name),
      description: String(item.description || ''),
      arguments: (item.arguments || []).map((arg) => ({
        name: String(arg?.name || ''),
        description: String(arg?.description || ''),
        required: arg?.required === true
      }))
    }));
}

export async function getMcpPrompt(
  server: McpServer,
  name: string,
  args: Record<string, string>
): Promise<string> {
  await ensureSession(server);
  const result = (await rpc(server, 'prompts/get', { name, arguments: args }, nextId())) as {
    messages?: Array<{ role?: string; content?: { type?: string; text?: string } }>;
  } | null;
  return (result?.messages || [])
    .map((message) => {
      const text =
        message?.content?.type === 'text'
          ? String(message.content.text || '')
          : JSON.stringify(message?.content || {});
      return `${message?.role === 'assistant' ? 'AI' : '用户'}：${text}`;
    })
    .join('\n\n')
    .slice(0, 20000);
}

/** 把已启用服务器的工具展开成可勾选列表（对话输入框的工具栏用）。 */
export async function listAllMcpTools(servers: McpServer[]): Promise<McpToolOption[]> {
  const options: McpToolOption[] = [];
  for (const server of servers.filter(
    (item) => item.enabled && (item.transport === 'stdio' ? item.command : item.url)
  )) {
    try {
      const tools = await listMcpTools(server);
      const allowed = server.toolNames || [];
      for (const tool of tools) {
        if (allowed.length && !allowed.includes(tool.name)) continue;
        options.push({
          id: `${server.id}__${tool.name}`,
          serverId: server.id,
          serverName: server.name,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        });
      }
    } catch {
      // 单个服务连不上不影响其它服务
    }
  }
  return options;
}

function enabledServers(servers: McpServer[]): McpServer[] {
  return servers.filter(
    (item) => item.enabled && (item.transport === 'stdio' ? item.command : item.url)
  );
}

/** 对话输入面板用：所有已启用服务的提示词。 */
export async function listAllMcpPrompts(servers: McpServer[]): Promise<McpPromptOption[]> {
  const options: McpPromptOption[] = [];
  for (const server of enabledServers(servers)) {
    try {
      const prompts = await listMcpPrompts(server);
      for (const prompt of prompts) {
        options.push({
          id: `${server.id}__${prompt.name}`,
          serverId: server.id,
          serverName: server.name,
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments
        });
      }
    } catch {
      // 单个服务连不上不影响其它服务
    }
  }
  return options;
}

/** 对话输入面板用：所有已启用服务的资源。 */
export async function listAllMcpResources(servers: McpServer[]): Promise<McpResourceOption[]> {
  const options: McpResourceOption[] = [];
  for (const server of enabledServers(servers)) {
    try {
      const resources = await listMcpResources(server);
      for (const resource of resources) {
        options.push({
          id: `${server.id}__${resource.uri}`,
          serverId: server.id,
          serverName: server.name,
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType
        });
      }
    } catch {
      // 单个服务连不上不影响其它服务
    }
  }
  return options;
}

export interface McpToolImage {
  mimeType: string;
  data: string;
}

export interface McpToolResult {
  text: string;
  images: McpToolImage[];
  structured?: unknown;
}

/** 把 tools/call 的 content 归一成文本 + 图片；二进制资源给占位说明。 */
export function parseMcpToolResult(result: unknown): McpToolResult {
  const payload = result as { content?: McpContentItem[]; structuredContent?: unknown } | null;
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const texts: string[] = [];
  const images: McpToolImage[] = [];
  for (const item of content) {
    if (!item) continue;
    if (item.type === 'text' && item.text) {
      texts.push(String(item.text));
      continue;
    }
    if (item.type === 'image' && item.data) {
      images.push({
        mimeType: String(item.mimeType || 'image/png'),
        data: String(item.data).slice(0, 8_000_000)
      });
      continue;
    }
    if (item.type === 'resource' && item.resource) {
      const resource = item.resource;
      if (resource.text) texts.push(String(resource.text));
      else if (resource.blob) {
        texts.push(
          `（二进制资源 ${resource.mimeType || ''} ${resource.uri || ''}，${resource.blob.length} 字符 base64）`
        );
      } else {
        texts.push(JSON.stringify(resource));
      }
      continue;
    }
    if (item.text) texts.push(String(item.text));
    else texts.push(JSON.stringify(item));
  }
  if (payload?.structuredContent !== undefined) {
    texts.push(JSON.stringify(payload.structuredContent));
  }
  const structured = payload?.structuredContent;
  const text =
    texts.filter(Boolean).join('\n') ||
    (images.length
      ? `（工具返回 ${images.length} 张图片）`
      : JSON.stringify(result, null, 2));
  return {
    text,
    images: images.slice(0, 4),
    ...(structured !== undefined ? { structured } : {})
  };
}

export async function callMcpToolDetailed(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 40000,
  signal?: AbortSignal,
  onProgress?: (progress: McpProgress) => void
): Promise<McpToolResult> {
  await ensureSession(server);
  const token = onProgress ? `mcp-progress-${server.id}-${nextId()}` : '';
  if (token && onProgress) progressHandlers.set(token, onProgress);
  try {
    const result = await rpc(
      server,
      'tools/call',
      {
        name,
        arguments: args,
        ...(token ? { _meta: { progressToken: token } } : {})
      },
      nextId(),
      timeoutMs,
      signal
    );
    return parseMcpToolResult(result);
  } finally {
    if (token) progressHandlers.delete(token);
  }
}

export async function callMcpTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 40000,
  signal?: AbortSignal
): Promise<string> {
  const result = await callMcpToolDetailed(server, name, args, timeoutMs, signal);
  return result.images.length
    ? `${result.text}\n（工具返回 ${result.images.length} 张图片，已在界面显示）`
    : result.text;
}

export function resetMcpSession(server: McpServer): void {
  sessionIds.delete(serverKey(server));
  protocolVersions.delete(serverKey(server));
  sseEndpoints.delete(serverKey(server));
  httpStreams.get(serverKey(server))?.abort();
  httpStreams.delete(serverKey(server));
  cancelElicitations(server);
  const client = stdioClients.get(stdioKey(server));
  if (client) {
    settleAll(client, new Error('MCP 会话已重置'));
    try {
      client.child.kill();
    } catch {
      // ignore
    }
    stdioClients.delete(stdioKey(server));
  }
}
