import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'exe' ? path.join(state.dir, 'shizi.exe') : state.dir)
  },
  session: { defaultSession: { fetch: vi.fn() } }
}));

import {
  basicTokens,
  deleteLocalEmbedding,
  encodeWithVocab,
  embedTextsLocal,
  localEmbeddingDir,
  localEmbeddingStatus,
  parseVocab,
  poolAndNormalize
} from './localEmbeddingModel';

const MODEL_SIZE = 24010842;
const VOCAB_SIZE = 109540;

describe('内置向量模型', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-embedding-'));
  });

  afterAll(() => {
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('BERT 分词：中文逐字、标点分隔、WordPiece 续接', () => {
    expect(basicTokens('你好，world!')).toEqual(['你', '好', '，', 'world', '!']);
    const vocab = parseVocab('[PAD]\n[UNK]\n[CLS]\n[SEP]\nhello\nworld\n##s\n你\n好');
    const encoded = encodeWithVocab('Hello worlds 你好', vocab);
    const tokens = encoded.ids.map((id) => [...vocab.entries()].find(([, value]) => value === id)?.[0]);
    expect(tokens).toEqual(['[CLS]', 'hello', 'world', '##s', '你', '好', '[SEP]']);
    expect(encoded.mask.every((value) => value === 1)).toBe(true);
  });

  it('均值池化后做 L2 归一化', () => {
    const vector = poolAndNormalize(Float32Array.from([1, 0, 0, 1, 1, 1]), [1, 1, 1], 2);
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2, 5);
    const norm = Math.hypot(vector[0], vector[1]);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('按文件大小判断安装状态，删除后清空', () => {
    expect(localEmbeddingStatus().installed).toBe(false);
    const dir = localEmbeddingDir();
    const modelPath = path.join(dir, 'model_quantized.onnx');
    const vocabPath = path.join(dir, 'vocab.txt');
    fs.writeFileSync(modelPath, '');
    fs.truncateSync(modelPath, MODEL_SIZE);
    fs.writeFileSync(vocabPath, '');
    fs.truncateSync(vocabPath, VOCAB_SIZE);
    expect(localEmbeddingStatus().installed).toBe(true);
    expect(localEmbeddingStatus().dimensions).toBe(512);
    expect(deleteLocalEmbedding()).toBe(true);
    expect(localEmbeddingStatus().installed).toBe(false);
  });
});

const protoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../proto/bge'
);
const protoModel = path.join(protoDir, 'model_quantized.onnx');
const hasProto = fs.existsSync(protoModel);

describe.skipIf(!hasProto)('内置向量模型（真实 ONNX 推理）', () => {
  beforeAll(() => {
    const dir = localEmbeddingDir();
    fs.copyFileSync(protoModel, path.join(dir, 'model_quantized.onnx'));
    fs.copyFileSync(path.join(protoDir, 'vocab.txt'), path.join(dir, 'vocab.txt'));
  });

  it('输出 512 维向量，相关句子相似度更高', async () => {
    const [a, b, c] = await embedTextsLocal([
      '如何用 Python 读取 CSV 文件',
      'Python 读取 CSV 的几种方法',
      '今天北京天气怎么样'
    ]);
    expect(a.length).toBe(512);
    const cosine = (x: Float32Array, y: Float32Array) => {
      let dot = 0;
      for (let i = 0; i < x.length; i += 1) dot += x[i] * y[i];
      return dot;
    };
    expect(cosine(a, b)).toBeGreaterThan(0.7);
    expect(cosine(a, c)).toBeLessThan(cosine(a, b));
  });
});
