import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import type { AsrDownloadProgress, LocalEmbeddingStatus } from '../shared/types';
import { downloadTo, type RemoteFile } from './localAsrSetup';

/**
 * 内置本地向量模型：bge-small-zh-v1.5（ONNX 量化，512 维）。
 * 模型按需下载到 userData；推理用 onnxruntime-node（N-API，随应用打包）。
 * 动态 import 运行时，缺少原生模块时只影响本地向量，不影响应用启动。
 */

export const LOCAL_EMBEDDING_MODEL_ID = 'bge-small-zh-v1.5';
export const LOCAL_EMBEDDING_MODEL_KEY = `local:${LOCAL_EMBEDDING_MODEL_ID}`;
export const LOCAL_EMBEDDING_MODEL_LABEL = 'BGE small zh v1.5';
export const LOCAL_EMBEDDING_DIMENSIONS = 512;

const MODEL_FILE = 'model_quantized.onnx';
const VOCAB_FILE = 'vocab.txt';

const MODEL: RemoteFile = {
  size: 24010842,
  sha256: '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc',
  urls: [
    'https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx',
    'https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main/onnx/model_quantized.onnx'
  ]
};

const VOCAB: RemoteFile = {
  size: 109540,
  sha256: '45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c',
  urls: [
    'https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main/vocab.txt',
    'https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main/vocab.txt'
  ]
};

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function localEmbeddingDir(): string {
  const dir = path.join(app.getPath('userData'), 'models', 'embedding', LOCAL_EMBEDDING_MODEL_ID);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function localEmbeddingStatus(): LocalEmbeddingStatus {
  const dir = localEmbeddingDir();
  const modelPath = path.join(dir, MODEL_FILE);
  const vocabPath = path.join(dir, VOCAB_FILE);
  const modelBytes = fileSize(modelPath);
  const vocabBytes = fileSize(vocabPath);
  return {
    id: LOCAL_EMBEDDING_MODEL_ID,
    label: LOCAL_EMBEDDING_MODEL_LABEL,
    installed: modelBytes === MODEL.size && vocabBytes === VOCAB.size,
    bytes: modelBytes + vocabBytes,
    dir,
    modelPath,
    dimensions: LOCAL_EMBEDDING_DIMENSIONS
  };
}

export async function downloadLocalEmbedding(
  onProgress: (progress: AsrDownloadProgress) => void,
  signal?: AbortSignal
): Promise<LocalEmbeddingStatus> {
  const dir = localEmbeddingDir();
  const status = localEmbeddingStatus();
  if (status.installed) return status;
  const modelPath = path.join(dir, MODEL_FILE);
  const vocabPath = path.join(dir, VOCAB_FILE);

  if (fileSize(modelPath) !== MODEL.size) {
    await downloadTo(
      MODEL,
      modelPath,
      'builtin:model',
      (progress) =>
        onProgress({ ...progress, percent: Math.min(95, Math.round(progress.percent * 0.95)) }),
      signal
    );
  }
  onProgress({
    key: 'builtin',
    percent: 96,
    received: 0,
    total: 0,
    message: '模型就绪，正在校验词典…'
  });
  if (fileSize(vocabPath) !== VOCAB.size) {
    await downloadTo(
      VOCAB,
      vocabPath,
      'builtin:vocab',
      (progress) =>
        onProgress({ ...progress, percent: 96 + Math.round(progress.percent * 0.04) }),
      signal
    );
  }
  onProgress({ key: 'builtin', percent: 100, received: 0, total: 0, message: '已就绪' });
  return localEmbeddingStatus();
}

export function deleteLocalEmbedding(): boolean {
  const dir = localEmbeddingDir();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    sessionPromise = null;
    runtimePromise = null;
    vocabCache = null;
    return !fs.existsSync(dir);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// BERT WordPiece 分词（bge-small-zh 是中文 BERT 词表，逐字切分 + WordPiece）
// ---------------------------------------------------------------------------

export type VocabMap = Map<string, number>;

export function parseVocab(text: string): VocabMap {
  const vocab: VocabMap = new Map();
  String(text || '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (line && !vocab.has(line)) vocab.set(line, index);
    });
  return vocab;
}

function isChineseCodePoint(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/** BERT BasicTokenizer：清洗、中文逐字、标点分隔、小写。 */
export function basicTokens(input: string): string[] {
  const cleaned = String(input || '')
    .replace(/[\u0000\u0005\uFFFD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let spaced = '';
  for (const char of cleaned) {
    if (char === ' ') {
      spaced += ' ';
      continue;
    }
    if (isChineseCodePoint(char.codePointAt(0) || 0) || /\p{P}/u.test(char)) {
      spaced += ` ${char} `;
      continue;
    }
    spaced += char.toLowerCase();
  }
  return spaced.split(/\s+/).filter(Boolean);
}

function wordPiece(token: string, vocab: VocabMap): string[] {
  if (token.length > 100) return ['[UNK]'];
  const pieces: string[] = [];
  let start = 0;
  while (start < token.length) {
    let end = token.length;
    let found: string | null = null;
    while (start < end) {
      const piece = start > 0 ? `##${token.slice(start, end)}` : token.slice(start, end);
      if (vocab.has(piece)) {
        found = piece;
        break;
      }
      end -= 1;
    }
    if (found === null) return ['[UNK]'];
    pieces.push(found);
    start = end;
  }
  return pieces;
}

export function encodeWithVocab(
  text: string,
  vocab: VocabMap,
  maxLength = 512
): { ids: number[]; mask: number[] } {
  const cls = vocab.get('[CLS]') ?? 101;
  const sep = vocab.get('[SEP]') ?? 102;
  const unk = vocab.get('[UNK]') ?? 100;
  const ids = [cls];
  outer: for (const token of basicTokens(text)) {
    for (const piece of wordPiece(token, vocab)) {
      ids.push(vocab.get(piece) ?? unk);
      if (ids.length >= maxLength - 1) break outer;
    }
  }
  ids.push(sep);
  return { ids, mask: ids.map(() => 1) };
}

/** 均值池化 + L2 归一化（与 bge / sentence-transformers 的默认一致）。 */
export function poolAndNormalize(
  data: Float32Array,
  mask: number[],
  dimensions: number
): Float32Array {
  const sum = new Float32Array(dimensions);
  let count = 0;
  for (let row = 0; row < mask.length; row += 1) {
    if (!mask[row]) continue;
    count += 1;
    const offset = row * dimensions;
    for (let dim = 0; dim < dimensions; dim += 1) sum[dim] += data[offset + dim];
  }
  const divisor = Math.max(1, count);
  let norm = 0;
  for (let dim = 0; dim < dimensions; dim += 1) {
    sum[dim] /= divisor;
    norm += sum[dim] * sum[dim];
  }
  norm = Math.sqrt(norm) || 1;
  for (let dim = 0; dim < dimensions; dim += 1) sum[dim] /= norm;
  return sum;
}

// ---------------------------------------------------------------------------
// 推理
// ---------------------------------------------------------------------------

type OrtModule = typeof import('onnxruntime-node');

let runtimePromise: Promise<OrtModule> | null = null;
let sessionPromise: Promise<InferenceSession> | null = null;
let vocabCache: VocabMap | null = null;

function loadVocab(dir: string): VocabMap {
  if (vocabCache) return vocabCache;
  const text = fs.readFileSync(path.join(dir, VOCAB_FILE), 'utf8');
  vocabCache = parseVocab(text);
  return vocabCache;
}

async function getRuntime(): Promise<OrtModule> {
  if (!runtimePromise) {
    runtimePromise = import('onnxruntime-node').catch((error: unknown) => {
      runtimePromise = null;
      throw new Error(
        `本地推理组件加载失败（onnxruntime-node）：${(error as Error)?.message || String(error)}`,
        { cause: error }
      );
    });
  }
  return runtimePromise;
}

async function getSession(): Promise<InferenceSession> {
  const status = localEmbeddingStatus();
  if (!status.installed) {
    throw new Error('内置向量模型未下载（设置 → AI 与语音 → 本地模型管理）');
  }
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await getRuntime();
      try {
        return await ort.InferenceSession.create(status.modelPath);
      } catch (error) {
        throw new Error(`本地向量模型加载失败：${(error as Error)?.message || error}`, {
          cause: error
        });
      }
    })().catch((error: unknown) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

/** 批量向量化；失败会明确提示是模型、运行时还是输入问题。 */
export async function embedTextsLocal(inputs: string[]): Promise<Float32Array[]> {
  const status = localEmbeddingStatus();
  if (!status.installed) {
    throw new Error('内置向量模型未下载（设置 → AI 与语音 → 本地模型管理）');
  }
  const session = await getSession();
  const ort = await getRuntime();
  const vocab = loadVocab(status.dir);
  const results: Float32Array[] = [];
  const batchSize = 8;

  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    const batch = inputs.slice(offset, offset + batchSize);
    const encoded = batch.map((text) => encodeWithVocab(String(text || ''), vocab, 512));
    const maxLength = Math.max(1, ...encoded.map((row) => row.ids.length));
    const ids = new BigInt64Array(encoded.length * maxLength);
    const mask = new BigInt64Array(encoded.length * maxLength);
    const types = new BigInt64Array(encoded.length * maxLength);
    encoded.forEach((row, rowIndex) => {
      const baseIndex = rowIndex * maxLength;
      for (let index = 0; index < row.ids.length; index += 1) {
        ids[baseIndex + index] = BigInt(row.ids[index]);
        mask[baseIndex + index] = 1n;
      }
    });
    const feeds: Record<string, Tensor> = {
      input_ids: new ort.Tensor('int64', ids, [encoded.length, maxLength]),
      attention_mask: new ort.Tensor('int64', mask, [encoded.length, maxLength])
    };
    if (session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = new ort.Tensor('int64', types, [encoded.length, maxLength]);
    }
    const output = await session.run(feeds);
    const key = session.outputNames.includes('last_hidden_state')
      ? 'last_hidden_state'
      : session.outputNames[0];
    const tensor = output[key];
    if (!tensor) throw new Error('本地向量模型没有输出 last_hidden_state');
    const dims = tensor.dims as number[];
    const dimensions = dims[dims.length - 1];
    const data = tensor.data as Float32Array;
    encoded.forEach((row, rowIndex) => {
      const start = rowIndex * maxLength * dimensions;
      results.push(
        poolAndNormalize(data.subarray(start, start + maxLength * dimensions), row.mask, dimensions)
      );
    });
  }
  return results;
}

export async function testLocalEmbeddingBuiltin(): Promise<{
  dimensions: number;
  latencyMs: number;
}> {
  const started = Date.now();
  const [vector] = await embedTextsLocal(['ping']);
  if (!vector) throw new Error('本地向量模型没有返回结果');
  return { dimensions: vector.length, latencyMs: Date.now() - started };
}

/** 退出应用时释放会话（可选，主要给测试和重启模型用）。 */
export function closeLocalEmbedding(): void {
  sessionPromise = null;
  vocabCache = null;
}
