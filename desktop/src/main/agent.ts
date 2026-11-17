import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { app, dialog } from 'electron';
import type { AddressInfo } from 'node:net';
import type { BrowserWindow, MessageBoxOptions } from 'electron';
import type { AgentStatus } from '../shared/types';
import { loadSettings, saveSettings, stripSecrets } from './settings';
import { getLibraryDetail, listLibrary, searchLibrary } from './library';
import { listPlugins } from './plugins';
import { listBrowserExtensions } from './extensions';
import { getPageInfo } from './page';
import { readPageContext } from './pageContext';
import type { TabManager } from './tabs';

/**
 * 本地 Agent 网关。
 *
 * 只监听 127.0.0.1，所有请求都要 Bearer Token；默认只读，
 * 写操作（打开/关闭标签、点击网页、改设置）在「未信任」状态下逐次弹确认。
 * 同时提供 /v1/agent/call（通用 JSON）和 /mcp（MCP Streamable HTTP 的无状态子集）。
 */

const MAX_BODY = 1024 * 1024;
const AUDIT_LIMIT = 512 * 1024;
const AGENT_PROTOCOL = 1;

type Scope = 'read' | 'write';

interface AgentContext {
  win: BrowserWindow | null;
  tabs: TabManager;
}

interface AgentTool {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: Record<string, unknown>;
  run: (ctx: AgentContext, args: Record<string, unknown>) => Promise<unknown>;
}

let server: http.Server | null = null;
let runningPort = 0;
let lastError = '';
let currentToken = '';
let context: AgentContext | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'agent-audit.log');
}

function audit(entry: Record<string, unknown>): void {
  try {
    const file = settingsFile();
    try {
      if (fs.statSync(file).size > AUDIT_LIMIT) fs.renameSync(file, `${file}.bak`);
    } catch {
      // 文件不存在时忽略
    }
    fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...entry })}\n`, 'utf8');
  } catch {
    // 审计写失败不影响调用
  }
}

function errorText(error: unknown): string {
  return (error as Error)?.message || String(error) || '未知错误';
}

function tokenMatches(input: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readToken(request: http.IncomingMessage): string {
  const header = String(request.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return String(request.headers['x-agent-token'] || '');
}

function isLoopback(request: http.IncomingMessage): boolean {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function json(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(body);
}

function readBody(request: http.IncomingMessage, limit = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
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

/* ------------------------------- 工具定义 ------------------------------- */

function stringArg(args: Record<string, unknown>, name: string, required = true): string {
  const value = String(args[name] ?? '').trim();
  if (!value && required) throw new Error(`缺少参数 ${name}`);
  return value;
}

function urlArg(args: Record<string, unknown>, name = 'url'): string {
  const value = stringArg(args, name);
  if (!/^https?:\/\//i.test(value)) throw new Error('只接受 http(s) 地址');
  return value;
}

function activeWebContents(ctx: AgentContext) {
  const webContents = ctx.tabs.activeWebContents();
  if (!webContents || webContents.isDestroyed()) throw new Error('当前没有活动标签页');
  return webContents;
}

const TOOLS: AgentTool[] = [
  {
    name: 'app.info',
    description: '应用版本、平台与当前窗口状态',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => ({
      name: '拾字',
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      chrome: process.versions.chrome
    })
  },
  {
    name: 'tabs.list',
    description: '列出所有标签页',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) =>
      ctx.tabs.list().map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active === true,
        pinned: tab.pinned === true,
        muted: tab.muted === true
      }))
  },
  {
    name: 'tabs.open',
    description: '打开一个新标签页',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'http(s) 地址' } },
      required: ['url'],
      additionalProperties: false
    },
    run: async (ctx, args) => ({ tabId: await ctx.tabs.create(urlArg(args)) })
  },
  {
    name: 'tabs.activate',
    description: '切换到指定标签页',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false
    },
    run: async (ctx, args) => {
      await ctx.tabs.activate(stringArg(args, 'id'));
      return true;
    }
  },
  {
    name: 'tabs.close',
    description: '关闭指定标签页',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false
    },
    run: async (ctx, args) => {
      ctx.tabs.close(stringArg(args, 'id'));
      return true;
    }
  },
  {
    name: 'tabs.navigate',
    description: '让当前标签页跳转到指定地址',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false
    },
    run: async (ctx, args) => {
      ctx.tabs.navigate(urlArg(args));
      return true;
    }
  },
  {
    name: 'page.info',
    description: '当前页面信息（标题、URL、类型、UP 主、时长）',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) => {
      const info = await getPageInfo(activeWebContents(ctx));
      return {
        title: info.title,
        url: info.url,
        kind: info.kind,
        bvid: info.bvid,
        cid: info.cid,
        owner: info.owner,
        duration: info.duration
      };
    }
  },
  {
    name: 'page.text',
    description: '当前页面的可读正文（默认最多 20000 字）',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        maxChars: { type: 'number', description: '1–200000，默认 20000' }
      },
      additionalProperties: false
    },
    run: async (ctx, args) => {
      const limit = Math.min(200000, Math.max(1, Math.round(Number(args.maxChars) || 20000)));
      const page = await readPageContext(activeWebContents(ctx), limit);
      if (!page) throw new Error('当前页面没有可提取的正文');
      return { title: page.title, url: page.url, text: page.text };
    }
  },
  {
    name: 'page.click',
    description: '点击页面上匹配 CSS 选择器的第一个元素',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
      additionalProperties: false
    },
    run: async (ctx, args) => {
      const selector = JSON.stringify(stringArg(args, 'selector'));
      return activeWebContents(ctx).executeJavaScript(`(() => {
        const el = document.querySelector(${selector});
        if (!el) return { ok: false, error: '找不到元素' };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return { ok: true, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 80) };
      })()`);
    }
  },
  {
    name: 'page.type',
    description: '往输入框/可编辑区域写入文本，可选提交表单',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean', description: '写入后提交所在表单' }
      },
      required: ['selector', 'text'],
      additionalProperties: false
    },
    run: async (ctx, args) => {
      const selector = JSON.stringify(stringArg(args, 'selector'));
      const text = JSON.stringify(String(args.text ?? ''));
      const submit = args.submit === true;
      return activeWebContents(ctx).executeJavaScript(`(() => {
        const el = document.querySelector(${selector});
        if (!el) return { ok: false, error: '找不到元素' };
        el.focus();
        const value = ${text};
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, value); else el.value = value;
        } else if (el.isContentEditable) {
          el.textContent = value;
        } else {
          return { ok: false, error: '元素不可输入' };
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (${submit}) {
          const form = el.closest && el.closest('form');
          if (form && form.requestSubmit) form.requestSubmit();
          else if (el.form && el.form.requestSubmit) el.form.requestSubmit();
        }
        return { ok: true };
      })()`);
    }
  },
  {
    name: 'page.scroll',
    description: '滚动当前页面',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
        amount: { type: 'number', description: '像素；默认一屏的 90%' }
      },
      required: ['direction'],
      additionalProperties: false
    },
    run: async (ctx, args) => {
      const direction = String(args.direction || 'down');
      if (!['up', 'down', 'top', 'bottom'].includes(direction)) {
        throw new Error('direction 只能是 up/down/top/bottom');
      }
      const amount = Math.max(0, Number(args.amount) || 0);
      const payload = JSON.stringify({ direction, amount });
      return activeWebContents(ctx).executeJavaScript(`(() => {
        const { direction, amount } = ${payload};
        const step = amount || Math.round(window.innerHeight * 0.9);
        if (direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (direction === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        else window.scrollBy({ top: direction === 'down' ? step : -step, behavior: 'smooth' });
        return { ok: true, y: window.scrollY };
      })()`);
    }
  },
  {
    name: 'page.wait',
    description: '等待页面上出现匹配选择器的元素',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        timeoutMs: { type: 'number', description: '默认 10000，最大 60000' }
      },
      required: ['selector'],
      additionalProperties: false
    },
    run: async (ctx, args) => {
      const selector = JSON.stringify(stringArg(args, 'selector'));
      const timeout = Math.min(60000, Math.max(500, Math.round(Number(args.timeoutMs) || 10000)));
      return activeWebContents(ctx).executeJavaScript(`new Promise((resolve) => {
        const selector = ${selector};
        const started = Date.now();
        const tick = () => {
          if (document.querySelector(selector)) return resolve({ ok: true, waited: Date.now() - started });
          if (Date.now() - started > ${timeout}) return resolve({ ok: false, error: '等待超时' });
          setTimeout(tick, 200);
        };
        tick();
      })`);
    }
  },
  {
    name: 'library.list',
    description: '最近入库的条目',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '默认 20，最大 100' } },
      additionalProperties: false
    },
    run: async (_ctx, args) => {
      const limit = Math.min(100, Math.max(1, Math.round(Number(args.limit) || 20)));
      const list = listLibrary('updated');
      return {
        total: list.total,
        items: list.videos.slice(0, limit).map((video) => ({
          id: video.id,
          title: video.title,
          owner: video.owner,
          duration: video.duration,
          url: video.url,
          kind: video.kind,
          updatedAt: video.updatedAt
        }))
      };
    }
  },
  {
    name: 'library.search',
    description: '在字幕库里搜索',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: '默认 10，最大 50' }
      },
      required: ['query'],
      additionalProperties: false
    },
    run: async (_ctx, args) => {
      const query = stringArg(args, 'query');
      const limit = Math.min(50, Math.max(1, Math.round(Number(args.limit) || 10)));
      const result = searchLibrary(query, Math.min(60, limit * 3));
      return {
        total: result.total,
        videos: result.videos.slice(0, limit),
        matches: result.matches.slice(0, limit).map((match) => ({
          videoId: match.videoId,
          title: match.title,
          start: match.start,
          text: match.text
        }))
      };
    }
  },
  {
    name: 'library.detail',
    description: '读取某条入库记录的视频信息、总结与笔记',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
      additionalProperties: false
    },
    run: async (_ctx, args) => {
      const id = Math.round(Number(args.id));
      if (!Number.isFinite(id) || id <= 0) throw new Error('id 必须是正整数');
      const detail = getLibraryDetail(id);
      return { video: detail.video, summary: detail.summary, note: detail.note };
    }
  },
  {
    name: 'settings.get',
    description: '读取设置（API Key / Token 已脱敏）',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => stripSecrets(loadSettings())
  },
  {
    name: 'plugins.list',
    description: '列出已安装的应用插件',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => listPlugins()
  },
  {
    name: 'extensions.list',
    description: '列出已安装的浏览器扩展',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => listBrowserExtensions()
  }
];

function toolByName(name: string): AgentTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** MCP 工具名只允许 [a-zA-Z0-9_-]；这里用下划线版本，并支持反向查找。 */
function mcpName(tool: AgentTool): string {
  return tool.name.replace(/\./g, '_');
}

function toolByMcpName(name: string): AgentTool | undefined {
  return TOOLS.find((tool) => mcpName(tool) === name || tool.name === name);
}

async function askApproval(tool: AgentTool, args: Record<string, unknown>): Promise<void> {
  const settings = loadSettings();
  if (settings.agent.trusted) return;
  const detail = `参数：${JSON.stringify(args).slice(0, 900)}`;
  const options: MessageBoxOptions = {
    type: 'question',
    buttons: ['允许一次', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    title: 'Agent 请求操作',
    message: `${tool.name} — ${tool.description}`,
    detail,
    checkboxLabel: '信任这个 Agent，以后不再逐次询问',
    checkboxChecked: false,
    noLink: true
  };
  const win = context?.win && !context.win.isDestroyed() ? context.win : null;
  const result = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (result.checkboxChecked) {
    saveSettings({ ...loadSettings(), agent: { ...loadSettings().agent, trusted: true } });
  }
  if (result.response !== 0) throw new Error('用户拒绝了这次操作');
}

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!context) throw new Error('Agent 服务尚未就绪');
  const tool = toolByName(name);
  if (!tool) throw new Error(`不支持的方法：${name}`);
  if (tool.scope === 'write') await askApproval(tool, args);
  try {
    const data = await tool.run(context, args);
    audit({ method: tool.name, scope: tool.scope, ok: true });
    return data;
  } catch (error) {
    audit({ method: tool.name, scope: tool.scope, ok: false, error: errorText(error) });
    throw error;
  }
}

/* --------------------------------- MCP --------------------------------- */

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

async function handleMcpMessage(message: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null;
  const method = String(message.method || '');
  const params = (message.params || {}) as Record<string, unknown>;

  if (!id && method.startsWith('notifications/')) return null;

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'shizi', version: app.getVersion() }
        }
      };
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map((tool) => ({
            name: mcpName(tool),
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }
      };
    }
    if (method === 'tools/call') {
      const name = String(params.name || '');
      const tool = toolByMcpName(name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `未知工具：${name}` }],
            isError: true
          }
        };
      }
      const args = (params.arguments || {}) as Record<string, unknown>;
      try {
        const data = await runTool(tool.name, args);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            isError: false
          }
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: errorText(error) }],
            isError: true
          }
        };
      }
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `不支持的方法：${method}` }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: errorText(error) }
    };
  }
}

/* -------------------------------- HTTP 服务 -------------------------------- */

function createHandler(): http.RequestListener {
  return (request, response) => {
    void (async () => {
      if (!isLoopback(request)) {
        json(response, 403, { ok: false, error: '只接受本机连接' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type, x-agent-token',
          'access-control-allow-methods': 'GET, POST, OPTIONS'
        });
        response.end();
        return;
      }
      if (!tokenMatches(readToken(request), currentToken)) {
        json(response, 401, { ok: false, error: 'Token 无效' });
        return;
      }

      const url = new URL(request.url || '/', 'http://127.0.0.1');

      if (url.pathname === '/v1/agent/health' && request.method === 'GET') {
        json(response, 200, { ok: true, protocol: AGENT_PROTOCOL, version: app.getVersion() });
        return;
      }

      if (url.pathname === '/v1/agent/info' && request.method === 'GET') {
        json(response, 200, {
          ok: true,
          protocol: AGENT_PROTOCOL,
          version: app.getVersion(),
          trusted: loadSettings().agent.trusted === true,
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            scope: tool.scope,
            inputSchema: tool.inputSchema
          }))
        });
        return;
      }

      if (url.pathname === '/v1/agent/call' && request.method === 'POST') {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(await readBody(request)) as Record<string, unknown>;
        } catch {
          json(response, 400, { ok: false, error: '请求体不是合法 JSON' });
          return;
        }
        try {
          const data = await runTool(String(payload.method || ''), (payload.params || {}) as Record<string, unknown>);
          json(response, 200, { ok: true, data });
        } catch (error) {
          json(response, 200, { ok: false, error: errorText(error) });
        }
        return;
      }

      if (url.pathname === '/mcp' && request.method === 'POST') {
        let payload: unknown;
        try {
          payload = JSON.parse(await readBody(request));
        } catch {
          json(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
          return;
        }
        const messages = Array.isArray(payload) ? (payload as JsonRpcRequest[]) : [payload as JsonRpcRequest];
        const results: Array<Record<string, unknown>> = [];
        for (const message of messages) {
          const result = await handleMcpMessage(message || {});
          if (result) results.push(result);
        }
        if (!results.length) {
          response.writeHead(202);
          response.end();
          return;
        }
        json(response, 200, Array.isArray(payload) ? results : results[0]);
        return;
      }

      json(response, 404, { ok: false, error: 'not found' });
    })().catch((error: unknown) => {
      try {
        json(response, 500, { ok: false, error: errorText(error) });
      } catch {
        // response 可能已结束
      }
    });
  };
}

function listenOnce(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const candidate = http.createServer(createHandler());
    const onError = (error: NodeJS.ErrnoException) => {
      candidate.removeListener('listening', onListening);
      candidate.close();
      reject(error);
    };
    const onListening = () => {
      candidate.removeListener('error', onError);
      resolve(candidate);
    };
    candidate.requestTimeout = 0;
    candidate.headersTimeout = 60000;
    candidate.once('error', onError);
    candidate.once('listening', onListening);
    candidate.listen(port, '127.0.0.1');
  });
}

export function agentStatus(): AgentStatus {
  const settings = loadSettings();
  return {
    enabled: settings.agent.enabled === true,
    running: Boolean(server),
    port: server ? runningPort : settings.agent.port,
    token: currentToken || settings.agent.token,
    trusted: settings.agent.trusted === true,
    ...(lastError ? { error: lastError } : {})
  };
}

export function stopAgent(): void {
  if (server) {
    try {
      server.close();
    } catch {
      // ignore
    }
  }
  server = null;
  runningPort = 0;
}

export async function startAgent(win: BrowserWindow | null, tabs: TabManager): Promise<AgentStatus> {
  stopAgent();
  lastError = '';
  context = { win, tabs };
  const settings = loadSettings();
  if (!settings.agent.enabled) {
    currentToken = settings.agent.token;
    return agentStatus();
  }

  let token = settings.agent.token;
  if (!token) {
    token = randomBytes(24).toString('hex');
    saveSettings({ ...loadSettings(), agent: { ...loadSettings().agent, token } });
    console.log('[agent] generated token');
  }
  currentToken = token;

  const basePort = settings.agent.port || 47830;
  for (let offset = 0; offset < 10; offset += 1) {
    try {
      server = await listenOnce(basePort + offset);
      runningPort = (server.address() as AddressInfo).port;
      console.log('[agent] listening', `http://127.0.0.1:${runningPort}/v1/agent/info`);
      return agentStatus();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') {
        lastError = errorText(error);
        console.warn('[agent] start failed:', lastError);
        break;
      }
    }
  }
  lastError = lastError || '端口被占用';
  return agentStatus();
}

/** 供测试/诊断：当前工具清单（不含实现）。 */
export function agentToolList(): Array<{ name: string; scope: Scope; description: string }> {
  return TOOLS.map((tool) => ({ name: tool.name, scope: tool.scope, description: tool.description }));
}
