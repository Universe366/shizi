import { describe, expect, it } from 'vitest';
import type { SubtitleTrack } from '../../../shared/types';
import { preferLocal } from './SubtitlesPanel';

const track = (url: string, source: string): SubtitleTrack => ({
  lan: source,
  lanDoc: source,
  url,
  isAi: false,
  aiStatus: null,
  source
});

describe('字幕回退顺序', () => {
  it('官方轨为空/失败时优先回到已保存的转写', () => {
    const officialA = track('https://example.com/a.json', 'library');
    const officialB = track('https://example.com/b.json', 'library');
    const saved = track('library://track/55', 'asr');
    const order = preferLocal([officialA, officialB, saved], new Set());
    expect(order.map((item) => item.url)).toEqual([
      'library://track/55',
      'https://example.com/a.json',
      'https://example.com/b.json'
    ]);
  });

  it('已经失败的轨不再重复尝试', () => {
    const saved = track('library://track/55', 'asr');
    const official = track('https://example.com/a.json', 'library');
    const order = preferLocal([saved, official], new Set([saved.url]));
    expect(order.map((item) => item.url)).toEqual(['https://example.com/a.json']);
  });
});
