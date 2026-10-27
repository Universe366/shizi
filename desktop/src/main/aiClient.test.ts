import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiPlatform } from '../shared/types';

const state = vi.hoisted(() => ({
  dir: '',
  queue: [] as Response[],
  calls: [] as Array<{ url: string; init: RequestInit }>
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  session: {
    defaultSession: {
      fetch: async (url: string, init: RequestInit) => {
        state.calls.push({ url, init });
        const next = state.queue.shift();
        if (!next) throw new Error('no mocked response');
        return next;
      }
    }
  }
}));

import { chatOnce, chatStream, chatToolLoopStream } from './aiClient';
import { closeUsage, usageEvents } from './usage';

function platform(patch: Partial<AiPlatform>): AiPlatform {
  return {
    id: 'p',
    name: 'Test',
    baseUrl: 'https://example.com/v1',
    apiKey: 'key',
    model: 'model',
    ...patch
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('AI 协议适配与用量', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-aiclient-'));
  });

  beforeEach(() => {
    state.queue = [];
    state.calls = [];
    closeUsage();
  });

  afterAll(() => {
    closeUsage();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('Gemini 原生：URL、请求头、systemInstruction 与 usage', async () => {
    state.queue.push(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: '你好' }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 }
      })
    );
    const gemini = platform({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      kind: 'gemini',
      model: 'gemini-2.5-flash'
    });
    const result = await chatOnce(
      gemini,
      [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: 'hi' }
      ],
      { task: 'chat', temperature: 0.2 }
    );
    expect(result.text).toBe('你好');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5 });

    const call = state.calls[0];
    expect(call.url).toContain('/models/gemini-2.5-flash:generateContent');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('key');
    const body = JSON.parse(String(call.init.body));
    expect(body.systemInstruction.parts[0].text).toBe('你是助手');
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(0);

    expect(usageEvents(10)[0]).toMatchObject({
      task: 'chat',
      model: 'gemini-2.5-flash',
      inputTokens: 12,
      outputTokens: 5
    });
  });

  it('Gemini 流式：解析 SSE 增量与最终 usage', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"你"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n\n'
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    });
    state.queue.push(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    );
    const gemini = platform({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      kind: 'gemini'
    });
    let streamed = '';
    const result = await chatStream(
      gemini,
      [{ role: 'user', content: 'hi' }],
      { task: 'summary', onDelta: (delta) => (streamed += delta) }
    );
    expect(result.text).toBe('你好');
    expect(streamed).toBe('你好');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it('Azure OpenAI：部署名路径与 api-key 头', async () => {
    state.queue.push(
      jsonResponse({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 1 }
      })
    );
    const azure = platform({
      baseUrl: 'https://res.openai.azure.com',
      kind: 'azure',
      model: 'my-deploy',
      apiVersion: '2024-10-21'
    });
    const result = await chatOnce(azure, [{ role: 'user', content: 'hi' }], { task: 'chat' });
    expect(result.text).toBe('ok');
    const call = state.calls[0];
    expect(call.url).toBe(
      'https://res.openai.azure.com/openai/deployments/my-deploy/chat/completions?api-version=2024-10-21'
    );
    const headers = call.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('key');
    expect(headers.authorization).toBeUndefined();
  });

  it('多 Key：401 时换用下一个 Key', async () => {
    state.queue.push(jsonResponse({ error: 'bad key' }, 401));
    state.queue.push(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const multi = platform({ apiKey: 'k1', extraKeys: ['k2'] });
    const result = await chatOnce(multi, [{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('ok');
    expect(state.calls.length).toBe(2);
    const first = state.calls[0].init.headers as Record<string, string>;
    const second = state.calls[1].init.headers as Record<string, string>;
    expect(first.authorization).toBe('Bearer k1');
    expect(second.authorization).toBe('Bearer k2');
  });
});

describe('流式工具循环', () => {
  beforeEach(() => {
    state.queue = [];
    state.calls = [];
  });

  const sse = (chunks: string[]): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  it('轮次用尽时改用无工具请求收尾', async () => {
    const toolChunk =
      'data: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'app__web_search', arguments: '{"query":"测试"}' }
                }
              ]
            }
          }
        ]
      }) +
      '\n\n';
    state.queue.push(sse([toolChunk, 'data: [DONE]\n\n']));
    state.queue.push(sse(['data: {"choices":[{"delta":{"content":"收尾"}}]}\n\n', 'data: [DONE]\n\n']));
    const result = await chatToolLoopStream(
      platform({ kind: 'openai' }),
      [{ role: 'user', content: '搜一下' }],
      [
        {
          name: 'app__web_search',
          description: '搜索',
          parameters: { type: 'object', properties: { query: { type: 'string' } } }
        }
      ],
      { task: 'chat', maxRounds: 1 },
      async () => '{"results":[]}'
    );
    expect(result.text).toBe('收尾');
    const finalBody = JSON.parse(String(state.calls[1].init.body));
    expect(finalBody.tools).toBeUndefined();
  });

  it('先流式解析 tool_calls，执行后再流式输出答案', async () => {
    const callChunk = (args: string, name?: string) =>
      'data: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: name ? { name, arguments: args } : { arguments: args }
                }
              ]
            }
          }
        ]
      }) +
      '\n\n';
    state.queue.push(
      sse([
        callChunk('{"query":', 'app__web_search'),
        callChunk('"测试"}'),
        'data: [DONE]\n\n'
      ])
    );
    state.queue.push(
      sse([
        'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n'
      ])
    );
    const runTool = vi.fn(async () => '{"results":[]}');
    let streamed = '';
    const result = await chatToolLoopStream(
      platform({ kind: 'openai' }),
      [{ role: 'user', content: '搜一下' }],
      [
        {
          name: 'app__web_search',
          description: '搜索',
          parameters: { type: 'object', properties: { query: { type: 'string' } } }
        }
      ],
      { task: 'chat', maxRounds: 3, onDelta: (delta) => (streamed += delta) },
      runTool
    );

    expect(runTool).toHaveBeenCalledWith({
      id: 'call_1',
      name: 'app__web_search',
      arguments: '{"query":"测试"}'
    });
    expect(result.text).toBe('答案');
    expect(streamed).toBe('答案');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });

    const secondBody = JSON.parse(String(state.calls[1].init.body));
    expect(secondBody.tools[0].function.name).toBe('app__web_search');
    expect(secondBody.messages.some((item: Record<string, unknown>) => item.role === 'tool')).toBe(
      true
    );
  });
});

describe('Anthropic / Gemini 流式工具循环', () => {
  const sse = (chunks: string[]): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  beforeEach(() => {
    state.queue = [];
    state.calls = [];
  });

  it('Anthropic：input_json_delta 拼出工具参数，执行后继续流式输出', async () => {
    state.queue.push(
      sse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"app__web_search","input":{}}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"测试\\"}"}}\n\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
        'data: {"type":"message_stop"}\n\n'
      ])
    );
    state.queue.push(
      sse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答案"}}\n\n',
        'data: {"type":"message_stop"}\n\n'
      ])
    );
    const runTool = vi.fn(async () => '{"results":[]}');
    let streamed = '';
    const result = await chatToolLoopStream(
      platform({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }),
      [{ role: 'user', content: '查一下' }],
      [
        {
          name: 'app__web_search',
          description: '搜索',
          parameters: { type: 'object', properties: { query: { type: 'string' } } }
        }
      ],
      { task: 'chat', maxRounds: 3, onDelta: (delta) => (streamed += delta) },
      runTool
    );
    expect(runTool).toHaveBeenCalledWith({
      id: 'toolu_1',
      name: 'app__web_search',
      arguments: '{"query":"测试"}'
    });
    expect(result.text).toBe('答案');
    expect(streamed).toBe('答案');
    const secondBody = JSON.parse(String(state.calls[1].init.body));
    expect(secondBody.messages.some((item: Record<string, unknown>) => item.role === 'user' && Array.isArray(item.content))).toBe(true);
  });

  it('Gemini：functionCall 后追加 functionResponse 并继续流式输出', async () => {
    state.queue.push(
      sse([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"app__web_search","args":{"query":"测试"}}}]}}]}\n\n'
      ])
    );
    state.queue.push(
      sse([
        'data: {"candidates":[{"content":{"parts":[{"text":"答案"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2}}\n\n'
      ])
    );
    const runTool = vi.fn(async () => '{"results":[]}');
    let streamed = '';
    const result = await chatToolLoopStream(
      platform({
        kind: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-2.5-flash'
      }),
      [{ role: 'user', content: '查一下' }],
      [
        {
          name: 'app__web_search',
          description: '搜索',
          parameters: { type: 'object', properties: { query: { type: 'string' } } }
        }
      ],
      { task: 'chat', maxRounds: 3, onDelta: (delta) => (streamed += delta) },
      runTool
    );
    expect(runTool).toHaveBeenCalledWith({
      id: '',
      name: 'app__web_search',
      arguments: '{"query":"测试"}'
    });
    expect(result.text).toBe('答案');
    expect(streamed).toBe('答案');
    const secondBody = JSON.parse(String(state.calls[1].init.body));
    expect(
      secondBody.contents.some(
        (item: Record<string, unknown>) =>
          item.role === 'user' &&
          Array.isArray(item.parts) &&
          (item.parts as Array<Record<string, unknown>>).some((part) => part.functionResponse)
      )
    ).toBe(true);
  });
});
