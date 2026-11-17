import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dir: '',
  response: 0,
  checkboxChecked: false,
  calls: [] as unknown[][],
  created: [] as string[],
  settings: {
    agent: { enabled: true, port: 0, token: 'test-token', trusted: false }
  } as { agent: { enabled: boolean; port: number; token: string; trusted: boolean } }
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '0.0.0' },
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      state.calls.push(args);
      return { response: state.response, checkboxChecked: state.checkboxChecked };
    }
  }
}));

vi.mock('./settings', () => ({
  loadSettings: () => state.settings,
  saveSettings: (next: typeof state.settings) => {
    state.settings = next;
    return next;
  },
  stripSecrets: (settings: Record<string, unknown>) => ({ ...settings, apiKey: '' })
}));

vi.mock('./library', () => ({
  listLibrary: () => ({ videos: [], stats: {}, total: 0 }),
  searchLibrary: () => ({ query: '', total: 0, matches: [], videos: [], mode: 'like' }),
  getLibraryDetail: () => ({ video: { id: 1 }, summary: null, note: null })
}));
vi.mock('./plugins', () => ({ listPlugins: () => [] }));
vi.mock('./extensions', () => ({ listBrowserExtensions: () => ({ enabled: true, items: [] }) }));
vi.mock('./page', () => ({ getPageInfo: async () => ({ title: 'T', url: 'https://a', kind: 'web', bvid: null, cid: null, owner: '', duration: 0 }) }));
vi.mock('./pageContext', () => ({ readPageContext: async () => ({ title: 'T', url: 'https://a', text: 'hello' }) }));

import { agentStatus, agentToolList, startAgent, stopAgent } from './agent';

const tabs = {
  list: () => [{ id: 'a', title: 'A', url: 'https://a', loading: false, active: true, canGoBack: false, canGoForward: false, suspended: false, zoom: 1 }],
  activeWebContents: () => ({ isDestroyed: () => false, executeJavaScript: async () => ({ ok: true }) }),
  create: async (url: string) => {
    state.created.push(url);
    return 'tab-new';
  },
  activate: async () => undefined,
  close: () => undefined,
  navigate: (url: string) => {
    state.created.push(url);
  }
} as never;

let port = 0;
const token = 'test-token';

async function call(method: string, params: unknown = {}, auth = token) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/agent/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
    body: JSON.stringify({ method, params })
  });
  return (await response.json()) as { ok: boolean; data?: unknown; error?: string };
}

async function mcp(payload: unknown, auth = token) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
    body: JSON.stringify(payload)
  });
  return (await response.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-agent-'));
  state.settings.agent.port = 46000 + Math.floor(Math.random() * 800);
  const status = await startAgent(null, tabs);
  port = status.port;
  expect(status.running).toBe(true);
});

afterAll(() => {
  stopAgent();
  fs.rmSync(state.dir, { recursive: true, force: true });
});

beforeEach(() => {
  state.calls.length = 0;
  state.created.length = 0;
  state.response = 0;
  state.checkboxChecked = false;
  state.settings.agent.trusted = false;
});

describe('Agent 网关', () => {
  it('状态与工具清单', () => {
    const status = agentStatus();
    expect(status.running).toBe(true);
    expect(status.port).toBe(port);
    const tools = agentToolList();
    expect(tools.find((tool) => tool.name === 'page.click')?.scope).toBe('write');
    expect(tools.find((tool) => tool.name === 'page.info')?.scope).toBe('read');
  });

  it('Token 校验', async () => {
    const denied = await call('app.info', {}, 'wrong-token');
    expect(denied.ok).toBe(false);
    const response = await fetch(`http://127.0.0.1:${port}/v1/agent/info`, {
      headers: { authorization: 'Bearer wrong' }
    });
    expect(response.status).toBe(401);
  });

  it('只读工具直接执行', async () => {
    const info = await call('app.info');
    expect(info.ok).toBe(true);
    expect(state.calls).toHaveLength(0);
  });

  it('写操作未信任时逐次确认：拒绝 / 允许', async () => {
    state.response = 1;
    const denied = await call('tabs.open', { url: 'https://example.com' });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('拒绝');
    expect(state.calls).toHaveLength(1);

    state.response = 0;
    const allowed = await call('tabs.open', { url: 'https://example.com' });
    expect(allowed.ok).toBe(true);
    expect(state.created).toContain('https://example.com');
    expect(state.calls).toHaveLength(2);
  });

  it('勾选「信任」后不再弹确认', async () => {
    state.response = 0;
    state.checkboxChecked = true;
    const first = await call('tabs.open', { url: 'https://b.test' });
    expect(first.ok).toBe(true);
    expect(state.settings.agent.trusted).toBe(true);

    state.calls.length = 0;
    const second = await call('tabs.open', { url: 'https://c.test' });
    expect(second.ok).toBe(true);
    expect(state.calls).toHaveLength(0);
  });

  it('参数校验与未知方法', async () => {
    const bad = await call('tabs.open', { url: 'file:///c:/x' });
    expect(bad.ok).toBe(false);
    const unknown = await call('nope.nope');
    expect(unknown.ok).toBe(false);
  });

  it('MCP：initialize / tools/list / tools/call', async () => {
    const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(init.result).toMatchObject({ protocolVersion: '2024-11-05' });

    const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const names = (list.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(names).toContain('app_info');
    expect(names).toContain('tabs_open');

    const called = await mcp({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'app_info', arguments: {} }
    });
    const result = called.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('拾字');
  });

  it('审计日志落在数据目录', () => {
    expect(fs.existsSync(path.join(state.dir, 'agent-audit.log'))).toBe(true);
  });
});
