import { describe, expect, it } from 'vitest';
import { buildKbContext, chunkText, clock, cosineSimilarity } from '../shared/kb';

describe('知识库纯函数', () => {
  it('长文本按大小切块并保留重叠', () => {
    const text = '第一段。'.repeat(120);
    const chunks = chunkText(text, 200, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 260)).toBe(true);
    expect(chunks.join('')).toContain('第一段');
  });

  it('短文本不切', () => {
    expect(chunkText('短文本')).toEqual(['短文本']);
    expect(chunkText('  ')).toEqual([]);
  });

  it('余弦相似度范围与正交', () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([0, 1]);
    const c = Float32Array.from([1, 1]);
    expect(cosineSimilarity(a, b)).toBe(0);
    expect(cosineSimilarity(a, c)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('时间戳与引用块', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_725_000)).toBe('1:02:05');
    const context = buildKbContext([
      { title: '视频 A', startMs: 65_000, text: '内容 A' },
      { title: '视频 B', startMs: 0, text: '内容 B' }
    ]);
    expect(context).toContain('[1] 视频 A @1:05');
    expect(context).toContain('[2] 视频 B @0:00');
  });
});
