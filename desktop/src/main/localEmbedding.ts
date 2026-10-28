import type { LocalEmbeddingTestResult } from '../shared/types';

/**
 * 本地向量服务：Ollama / LM Studio / llama.cpp 的 OpenAI 兼容 /embeddings。
 * 桌面端不内置推理运行时，负责发现本机服务、验证模型可用并把设置指过去。
 */

const LOOPBACK = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i;

/** 地址必须是本机回环，避免设置页被用来探测任意网络。 */
export function normalizeLocalBaseUrl(input: string): string {
  const raw = String(input || '')
    .trim()
    .replace(/\/+$/, '')
    // 允许直接粘贴完整的 /embeddings 地址。
    .replace(/\/embeddings$/i, '');
  if (!raw) throw new Error('请填写本地服务地址，例如 http://127.0.0.1:11434/v1');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('服务地址格式不正确，例如 http://127.0.0.1:11434/v1');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('本地服务只支持 http / https');
  }
  if (!LOOPBACK.test(url.hostname)) {
    throw new Error('本地服务地址必须是 127.0.0.1、localhost 或 [::1]');
  }
  return raw;
}

function firstVector(payload: unknown): number[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as {
    data?: unknown;
    embeddings?: unknown;
    embedding?: unknown;
  };
  const asVector = (value: unknown): number[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'number')
      ? (value as number[])
      : [];
  if (Array.isArray(record.data)) {
    for (const row of record.data) {
      const vector = asVector((row as { embedding?: unknown })?.embedding);
      if (vector.length) return vector;
    }
  }
  if (Array.isArray(record.embeddings)) {
    for (const row of record.embeddings) {
      const vector = asVector(row);
      if (vector.length) return vector;
    }
  }
  return asVector(record.embedding);
}

export interface LocalEmbeddingInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export async function testLocalEmbedding(
  input: LocalEmbeddingInput
): Promise<LocalEmbeddingTestResult> {
  const baseUrl = normalizeLocalBaseUrl(input.baseUrl);
  const model = String(input.model || '').trim();
  if (!model) throw new Error('请先选择 embedding 模型');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: 'ping' }),
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    throw new Error(`连不上本地服务：${message}`, { cause: error });
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`embedding HTTP ${response.status}：${text.slice(0, 160)}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error('embedding 返回的不是 JSON');
  }
  const vector = firstVector(payload);
  if (!vector.length) throw new Error('embedding 没有返回向量，确认选的是向量模型');
  return { dimensions: vector.length, latencyMs: Date.now() - started, model };
}
