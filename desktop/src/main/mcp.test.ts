import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '../shared/types';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  responder: null as null | ((body: Record<string, unknown>, init: RequestInit) => Response)
}));

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      fetch: async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body || '{}')) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
        };
        state.calls.push(String(body.method));
        if (state.responder) return state.responder(body, init);
        let result: unknown = {};
        if (body.method === 'initialize') {
          result = { protocolVersion: '2024-11-05', capabilities: {} };
        } else if (body.method === 'resources/list') {
          result = {
            resources: [
              { uri: 'file:///a.md', name: 'A', description: '描述', mimeType: 'text/markdown' }
            ]
          };
        } else if (body.method === 'resources/read') {
          result = { contents: [{ text: '资源正文', mimeType: 'text/plain' }] };
        } else if (body.method === 'prompts/list') {
          result = {
            prompts: [
              { name: 'review', description: '审阅', arguments: [{ name: 'text', required: true }] }
            ]
          };
        } else if (body.method === 'prompts/get') {
          result = {
            messages: [{ role: 'user', content: { type: 'text', text: '提示词正文' } }]
          };
        } else if (body.method === 'tools/list') {
          result = {
            tools: [{ name: 'echo', description: '回声', inputSchema: { type: 'object' } }]
          };
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }
  }
}));

import {
  callMcpToolDetailed,
  getMcpPrompt,
  listAllMcpPrompts,
  listAllMcpResources,
  listAllMcpTools,
  listMcpPrompts,
  listMcpResources,
  parseMcpToolResult,
  readMcpResource,
  setMcpNotificationSink
} from './mcp';

const server: McpServer = {
  id: 'test',
  name: '测试',
  url: 'https://example.com/mcp',
  token: '',
  headers: {},
  enabled: true,
  transport: 'http'
};

describe('MCP 资源与提示词', () => {
  beforeEach(() => {
    state.calls = [];
    state.responder = null;
    setMcpNotificationSink(null);
  });

  it('列出资源并读取正文', async () => {
    const resources = await listMcpResources(server);
    expect(resources).toEqual([
      { uri: 'file:///a.md', name: 'A', description: '描述', mimeType: 'text/markdown' }
    ]);
    const text = await readMcpResource(server, 'file:///a.md');
    expect(text).toBe('资源正文');
    expect(state.calls).toContain('resources/list');
    expect(state.calls).toContain('resources/read');
  });

  it('列出提示词并取出消息', async () => {
    const prompts = await listMcpPrompts(server);
    expect(prompts[0]).toMatchObject({ name: 'review', arguments: [{ name: 'text', required: true }] });
    const text = await getMcpPrompt(server, 'review', { text: 'x' });
    expect(text).toContain('提示词正文');
    expect(state.calls).toContain('prompts/list');
    expect(state.calls).toContain('prompts/get');
  });

  it('工具结果保留图片与资源文本', () => {
    const result = parseMcpToolResult({
      content: [
        { type: 'text', text: '说明' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        { type: 'resource', resource: { text: '资源正文', mimeType: 'text/plain' } }
      ]
    });
    expect(result.text).toBe('说明\n资源正文');
    expect(result.images).toEqual([{ mimeType: 'image/png', data: 'AAAA' }]);

    const onlyImage = parseMcpToolResult({
      content: [{ type: 'image', mimeType: 'image/jpeg', data: 'BBBB' }]
    });
    expect(onlyImage.text).toBe('（工具返回 1 张图片）');
    expect(onlyImage.images[0].mimeType).toBe('image/jpeg');
  });

  it('POST 返回 SSE 时先派发通知，再解析本次响应', async () => {
    const encoder = new TextEncoder();
    state.responder = (body) => {
      if (body.method === 'tools/call') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const meta = body.params as { _meta?: { progressToken?: string } } | undefined;
            const progressToken = (meta && meta._meta && meta._meta.progressToken) || 't';
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'notifications/progress',
                  params: { progressToken, progress: 1, total: 2, message: '下载中' }
                })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  jsonrpc: '2.0',
                  id: body.id,
                  result: { content: [{ type: 'text', text: '完成' }] }
                })}\n\n`
              )
            );
            controller.close();
          }
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        });
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };
    const events: string[] = [];
    setMcpNotificationSink((_server, method) => events.push(method));
    const progress: number[] = [];
    const result = await callMcpToolDetailed(server, 'echo', {}, 4000, undefined, (item) =>
      progress.push(item.progress)
    );
    expect(result.text).toBe('完成');
    expect(events).toContain('notifications/progress');
    expect(progress).toEqual([1]);
  });

  it('展开提示词与资源，跳过停用服务', async () => {
    const prompts = await listAllMcpPrompts([
      { ...server, id: 'a', name: '服务 A' },
      { ...server, id: 'b', name: '停用', enabled: false }
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      id: 'a__review',
      serverId: 'a',
      serverName: '服务 A',
      name: 'review'
    });
    expect(prompts[0].arguments[0]).toMatchObject({ name: 'text', required: true });

    const resources = await listAllMcpResources([{ ...server, id: 'a', name: '服务 A' }]);
    expect(resources[0]).toMatchObject({
      id: 'a__file:///a.md',
      serverId: 'a',
      serverName: '服务 A',
      uri: 'file:///a.md'
    });
  });

  it('展开可勾选工具：跳过禁用服务与未授权工具', async () => {
    const options = await listAllMcpTools([
      { ...server, id: 'a', name: '服务 A' },
      { ...server, id: 'b', name: '服务 B', toolNames: ['other'] },
      { ...server, id: 'c', name: '停用', enabled: false },
      { ...server, id: 'd', name: '无地址', url: '' }
    ]);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      id: 'a__echo',
      serverId: 'a',
      serverName: '服务 A',
      name: 'echo'
    });
  });
});
