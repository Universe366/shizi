import type { LocalEmbeddingTestResult, OllamaPullProgress } from '../shared/types';

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

export function normalizeOllamaModel(input: string): string {
  const model = String(input || '').trim();
  if (!model) throw new Error('请填写模型名，例如 nomic-embed-text');
  if (!/^[a-zA-Z0-9._/:@-]{1,120}$/.test(model)) {
    throw new Error('模型名只能包含字母、数字和 . _ / : @ -');
  }
  return model;
}

/** OpenAI 兼容地址 → Ollama 根地址（去掉 /v1）。 */
export function ollamaApiRoot(baseUrl: string): string {
  return normalizeLocalBaseUrl(baseUrl).replace(/\/v1$/i, '');
}

export interface OllamaPullLine {
  status?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export function parseOllamaPullLine(line: string): OllamaPullLine | null {
  const text = String(line || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      status?: unknown;
      total?: unknown;
      completed?: unknown;
      error?: unknown;
    };
    const result: OllamaPullLine = {};
    if (typeof parsed.status === 'string' && parsed.status.trim()) {
      result.status = parsed.status.trim();
    }
    if (typeof parsed.total === 'number' && Number.isFinite(parsed.total)) {
      result.total = parsed.total;
    }
    if (typeof parsed.completed === 'number' && Number.isFinite(parsed.completed)) {
      result.completed = parsed.completed;
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      result.error = parsed.error.trim();
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * 用本机 Ollama 拉取 embedding 模型：POST /api/pull 的 NDJSON 流按行解析，
 * 把 total/completed 换算成进度；下载本身由 Ollama 完成，不经过桌面端服务器。
 */
export async function pullOllamaEmbedding(
  input: { baseUrl: string; model: string },
  onProgress: (progress: OllamaPullProgress) => void,
  signal?: AbortSignal
): Promise<{ model: string }> {
  const base = ollamaApiRoot(input.baseUrl);
  const model = normalizeOllamaModel(input.model);
  let response: Response;
  try {
    response = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw new Error('已取消', { cause: error });
    const message = (error as Error)?.message || String(error);
    throw new Error(`连不上 Ollama：${message}`, { cause: error });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama 拉取失败 HTTP ${response.status}：${text.slice(0, 160)}`);
  }
  if (!response.body) throw new Error('Ollama 没有返回下载流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let percent = 0;
  let status = '准备拉取…';
  const handleLine = (line: string) => {
    const parsed = parseOllamaPullLine(line);
    if (!parsed) return;
    if (parsed.error) throw new Error(`Ollama：${parsed.error}`);
    if (parsed.status) status = parsed.status;
    if (parsed.status === 'success') percent = 100;
    else if (parsed.total && parsed.total > 0 && typeof parsed.completed === 'number') {
      percent = Math.max(0, Math.min(99, Math.floor((parsed.completed / parsed.total) * 100)));
    }
    onProgress({
      model,
      percent,
      status,
      total: parsed.total,
      completed: parsed.completed
    });
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    }
    if (buffer.trim()) handleLine(buffer);
  } catch (error) {
    if (signal?.aborted) throw new Error('已取消', { cause: error });
    throw error;
  }
  onProgress({ model, percent: 100, status: '完成' });
  return { model };
}

