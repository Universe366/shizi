import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { session } from 'electron';
import type { McpServer, McpTool } from '../shared/types';

const PROTOCOL_VERSION = '2024-11-05';
const sessionIds = new Map<string, string>();
let seq = 0;
const nextId = () => ++seq;

function serverKey(server: McpServer): string {
  return `${server.id}|${server.url}`;
}

function headersFor(server: McpServer): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json'
  };
  const token = String(server.token || '').trim();
  if (token) headers.authorization = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  for (const [key, value] of Object.entries(server.headers || {})) {
    if (key && value) headers[key] = String(value);
  }
  const sessionId = sessionIds.get(serverKey(server));
  if (sessionId) headers['mcp-session-id'] = sessionId;
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

async function postHttp(server: McpServer, body: unknown, timeoutMs = 40000): Promise<Response> {
  if (!server.url.trim()) throw new Error('MCP 服务地址为空');
  const response = await session.defaultSession.fetch(server.url.trim(), {
    method: 'POST',
    headers: headersFor(server),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId) sessionIds.set(serverKey(server), sessionId);
  return response;
}

async function rpcHttp(
  server: McpServer,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 40000
): Promise<JsonRpcResult | null> {
  const response = await postHttp(
    server,
    {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params })
    },
    timeoutMs
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP 服务返回 HTTP ${response.status}：${text.slice(0, 200)}`);
  }
  const message = parseRpc(text, id);
  if (!message) throw new Error('MCP 响应无法解析');
  if (message.error) {
    throw new Error(`MCP 调用出错（${message.error.code ?? '?'}）：${message.error.message || ''}`);
  }
  return (message.result as JsonRpcResult | undefined) ?? null;
}

interface SseEvent {
  event: string;
  data: string;
}

async function rpcSse(
  server: McpServer,
  body: { jsonrpc: string; id?: number; method: string; params?: unknown },
  expectId: number | null,
  timeoutMs = 40000
): Promise<JsonRpcResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    controller.abort();
  }
}

async function rpc(
  server: McpServer,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 40000
): Promise<JsonRpcResult | null> {
  if (server.transport === 'stdio') {
    return stdioRequest(server, method, params, timeoutMs);
  }
  if (server.transport === 'sse') {
    return rpcSse(server, { jsonrpc: '2.0', id, method, params }, id, timeoutMs);
  }
  return rpcHttp(server, method, params, id, timeoutMs);
}

// ---------------------------------------------------------------------------
// stdio 传输：本地 MCP 服务（npx / uvx / node / python）通过 stdin/stdout 走
// 换行分隔的 JSON-RPC。进程由我们拉起，退出/禁用时负责回收。
// ---------------------------------------------------------------------------

interface StdioPending {
  resolve: (result: JsonRpcResult | null) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface StdioClient {
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
  if (typeof message.id !== 'number') return;
  const pending = client.pending.get(message.id);
  if (!pending) return;
  clearTimeout(pending.timer);
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
  timeoutMs = 40000
): Promise<JsonRpcResult | null> {
  const client = startStdio(server);
  const id = ++client.seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(`MCP stdio 超时（${Math.round(timeoutMs / 1000)} 秒）：${method}`));
    }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
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

async function ensureSession(server: McpServer): Promise<void> {
  if (server.transport === 'stdio') {
    const client = startStdio(server);
    if (client.initialized) return;
    await rpc(
      server,
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'shizi', version: '1.0.0' }
      },
      nextId()
    );
    await notifyInitialized(server);
    client.initialized = true;
    return;
  }
  if (sessionIds.has(serverKey(server))) return;
  await rpc(
    server,
    'initialize',
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'shizi', version: '1.0.0' }
    },
    nextId()
  );
  await notifyInitialized(server);
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

export async function callMcpTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 40000
): Promise<string> {
  await ensureSession(server);
  const result = await rpc(server, 'tools/call', { name, arguments: args }, nextId(), timeoutMs);
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .map((item) => {
      if (item?.type === 'text') return String(item.text || '');
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .filter(Boolean)
    .join('\n');
  return text || JSON.stringify(result, null, 2);
}

export function resetMcpSession(server: McpServer): void {
  sessionIds.delete(serverKey(server));
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
