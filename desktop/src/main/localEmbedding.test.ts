import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OllamaPullProgress } from '../shared/types';
import {
  normalizeLocalBaseUrl,
  normalizeOllamaModel,
  ollamaApiRoot,
  parseOllamaPullLine,
  pullOllamaEmbedding,
  testLocalEmbedding
} from './localEmbedding';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('本地 embedding 服务', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('只接受本机回环地址', () => {
    expect(normalizeLocalBaseUrl('http://127.0.0.1:11434/v1/')).toBe(
      'http://127.0.0.1:11434/v1'
    );
    expect(normalizeLocalBaseUrl('http://localhost:1234/v1')).toBe(
      'http://localhost:1234/v1'
    );
    expect(normalizeLocalBaseUrl('http://127.0.0.1:11434/v1/embeddings')).toBe(
      'http://127.0.0.1:11434/v1'
    );
    expect(() => normalizeLocalBaseUrl('https://api.example.com/v1')).toThrow(/127\.0\.0\.1|localhost/);
    expect(() => normalizeLocalBaseUrl('')).toThrow(/服务地址/);
    expect(() => normalizeLocalBaseUrl('ftp://127.0.0.1/v1')).toThrow(/http/);
  });

  it('解析 OpenAI 兼容向量并返回维度', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await testLocalEmbedding({
      baseUrl: 'http://127.0.0.1:11434/v1/',
      model: 'nomic-embed-text'
    });
    expect(result.dimensions).toBe(3);
    expect(result.model).toBe('nomic-embed-text');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/embeddings',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('兼容 Ollama 原生 embeddings 结构', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ embeddings: [[1, 2, 3, 4]] }))
    );
    const result = await testLocalEmbedding({
      baseUrl: 'http://localhost:11434/v1',
      model: 'bge-m3'
    });
    expect(result.dimensions).toBe(4);
  });

  it('HTTP 错误、非 JSON、空向量都有明确提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'model not found' }, 404))
    );
    await expect(
      testLocalEmbedding({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'x' })
    ).rejects.toThrow(/HTTP 404/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 200 })));
    await expect(
      testLocalEmbedding({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'x' })
    ).rejects.toThrow(/不是 JSON/);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
    await expect(
      testLocalEmbedding({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'x' })
    ).rejects.toThrow(/没有返回向量/);
  });

  it('解析 Ollama 根地址、模型名与 NDJSON 进度', () => {
    expect(ollamaApiRoot('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434');
    expect(ollamaApiRoot('http://localhost:11434')).toBe('http://localhost:11434');
    expect(normalizeOllamaModel('bge-m3')).toBe('bge-m3');
    expect(() => normalizeOllamaModel('bad model')).toThrow(/模型名/);
    expect(parseOllamaPullLine('{"status":"downloading","total":100,"completed":50}')).toEqual({
      status: 'downloading',
      total: 100,
      completed: 50
    });
    expect(parseOllamaPullLine('not json')).toBeNull();
    expect(parseOllamaPullLine('{"error":"boom"}')).toEqual({ error: 'boom' });
  });

  it('拉取 Ollama 模型并按行回报进度', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            '{"status":"pulling manifest"}\n{"status":"downloading","total":100,"completed":50}\n'
          )
        );
        controller.enqueue(encoder.encode('{"status":"success"}\n'));
        controller.close();
      }
    });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const events: OllamaPullProgress[] = [];
    const result = await pullOllamaEmbedding(
      { baseUrl: 'http://127.0.0.1:11434/v1', model: 'nomic-embed-text' },
      (progress) => events.push(progress)
    );
    expect(result.model).toBe('nomic-embed-text');
    expect(events.some((event) => event.percent === 50)).toBe(true);
    expect(events.at(-1)?.percent).toBe(100);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/pull',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
