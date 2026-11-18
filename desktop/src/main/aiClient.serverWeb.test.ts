import { describe, expect, it, vi } from 'vitest';
import type { AiPlatform } from '../shared/types';

const state = vi.hoisted(() => ({
  chunks: [] as string[]
}));

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      fetch: vi.fn(async () => {
        const body = state.chunks.map((chunk) => `data: ${chunk}\n\n`).join('') + 'data: [DONE]\n\n';
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        });
      })
    }
  }
}));

vi.mock('./usage', () => ({ recordUsage: vi.fn() }));

import { chatDeepSeekWebStream } from './aiClient';

const platform = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'test-key',
  model: 'deepseek-flash',
  models: ['deepseek-flash'],
  enabled: true
} as AiPlatform;

describe('DeepSeek 服务端联网', () => {
  it('解析工具事件、来源与行内引用', async () => {
    state.chunks = [
      JSON.stringify({ choices: [{ delta: { reasoning_content: '思考中' } }] }),
      JSON.stringify({
        choices: [
          {
            server_tool_event: {
              type: 'call_started',
              step: 0,
              call: { kind: 'search', action: { type: 'search', queries: ['法国首都'] } }
            }
          }
        ]
      }),
      JSON.stringify({
        choices: [
          {
            server_tool_event: {
              type: 'call_completed',
              step: 0,
              call: {
                kind: 'search',
                status: 'completed',
                sources: [
                  {
                    url: 'https://example.com/paris',
                    title: '巴黎',
                    snippet: '巴黎是法国首都',
                    site_name: 'Example'
                  }
                ]
              }
            }
          }
        ]
      }),
      JSON.stringify({ choices: [{ delta: { content: '巴黎是法国首都。' } }] }),
      JSON.stringify({
        choices: [
          {
            delta: {
              server_tool_calls: [
                {
                  index: 0,
                  calls: [
                    {
                      index: 0,
                      kind: 'search',
                      status: 'completed',
                      sources: [{ url: 'https://example.com/paris', title: '巴黎' }]
                    }
                  ]
                }
              ],
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: {
                    url: 'https://example.com/paris',
                    title: '巴黎',
                    start_index: 0,
                    end_index: 8
                  }
                }
              ]
            }
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          server_tool_use: { tool_search: 1, tool_fetch: 0 }
        }
      })
    ];

    const events: Array<{ phase: string; name: string }> = [];
    const result = await chatDeepSeekWebStream(platform, [{ role: 'user', content: '法国首都是哪？' }], {
      task: 'chat',
      onServerTool: (event) => events.push({ phase: event.phase, name: event.name })
    });

    expect(result.text).toBe('巴黎是法国首都。[1]');
    expect(result.reasoning).toBe('思考中');
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      url: 'https://example.com/paris',
      title: '巴黎'
    });
    expect(result.searchCount).toBe(1);
    expect(result.fetchCount).toBe(0);
    expect(events).toEqual([
      { phase: 'start', name: 'web_search' },
      { phase: 'done', name: 'web_search' }
    ]);
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it('模型没有输出文本时抛错', async () => {
    state.chunks = [JSON.stringify({ choices: [{ delta: {} }] })];
    await expect(
      chatDeepSeekWebStream(platform, [{ role: 'user', content: 'hi' }], {})
    ).rejects.toThrow('AI 返回为空');
  });
});
