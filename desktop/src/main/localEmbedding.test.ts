import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeLocalBaseUrl, testLocalEmbedding } from './localEmbedding';

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
});
