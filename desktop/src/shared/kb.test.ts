import { describe, expect, it } from 'vitest';
import { hybridScore, keywordScore, tokenize } from './kb';

describe('tokenize', () => {
  it('中文按字与二字切分，英文按词', () => {
    const terms = tokenize('本地 ASR 断句');
    expect(terms).toContain('本');
    expect(terms).toContain('本地');
    expect(terms).toContain('asr');
    expect(terms).toContain('断句');
  });
});

describe('keywordScore', () => {
  it('完全命中为 1，未命中为 0', () => {
    expect(keywordScore('本地 ASR', '本地 whisper 的 ASR 结论')).toBe(1);
    expect(keywordScore('向量索引', '完全无关的一段话')).toBe(0);
  });

  it('部分命中按比例计分', () => {
    const score = keywordScore('本地 ASR 断句', '只提到本地');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('hybridScore', () => {
  it('向量为主、关键词加成', () => {
    expect(hybridScore(0, 1)).toBeCloseTo(0.28, 5);
    expect(hybridScore(1, 0)).toBeCloseTo(0.72, 5);
    expect(hybridScore(0.8, 0.8)).toBeCloseTo(0.8, 5);
  });

  it('负向量分按 0 处理', () => {
    expect(hybridScore(-0.5, 0)).toBe(0);
  });
});
