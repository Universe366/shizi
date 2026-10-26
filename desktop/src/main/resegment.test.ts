import { describe, expect, it } from 'vitest';
import type { SubtitleLine } from '../shared/types';
import {
  parseSegmentationGroups,
  resegmentByRules,
  segmentationPrompt
} from './resegment';

const line = (start: number, end: number, text: string): SubtitleLine => ({ start, end, text });

describe('resegmentByRules', () => {
  it('合并不完整/过短的碎句', () => {
    const result = resegmentByRules(
      [line(0, 0.6, '这是'), line(0.6, 1.2, '一句'), line(1.2, 2, '完整的话。')],
      { maxChars: 24, minDuration: 1.2, useAi: false }
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('这是一句完整的话。');
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(2);
  });

  it('长句按标点拆开，时间按字数分配', () => {
    const result = resegmentByRules(
      [line(0, 10, '第一句话比较长，需要拆开；第二句话也不短，同样需要拆开。')],
      { maxChars: 12, minDuration: 1, useAi: false }
    );
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].start).toBe(0);
    expect(result[result.length - 1].end).toBeCloseTo(10, 1);
    for (const item of result) expect(item.text.length).toBeLessThanOrEqual(14);
  });

  it('句子已结束且间隔较大时不硬合并', () => {
    const result = resegmentByRules(
      [line(0, 2, '第一句。'), line(6, 8, '第二句。')],
      { maxChars: 24, minDuration: 1, useAi: false }
    );
    expect(result).toHaveLength(2);
  });
});

describe('parseSegmentationGroups', () => {
  it('只接受完整且有序的分组', () => {
    expect(parseSegmentationGroups('[[1,2],[3]]', 3)).toEqual([[0, 1], [2]]);
    expect(parseSegmentationGroups('```json\n[[1,2],[3]]\n```', 3)).toEqual([[0, 1], [2]]);
    expect(parseSegmentationGroups('[[1],[2]]', 3)).toBeNull();
    expect(parseSegmentationGroups('[[2],[1]]', 2)).toBeNull();
    expect(parseSegmentationGroups('不是 JSON', 2)).toBeNull();
  });

  it('提示词包含行号与行数', () => {
    const prompt = segmentationPrompt([line(0, 1, '第一行'), line(1, 2, '第二行')], 24);
    expect(prompt).toContain('2 条字幕');
    expect(prompt).toContain('1. 第一行');
  });
});
