import { describe, expect, it } from 'vitest';
import { overallPercent, parseYtDlpItem, parseYtDlpProgress } from './ytdlp';

describe('parseYtDlpProgress', () => {
  it('解析百分比、体积、速度与 ETA', () => {
    expect(
      parseYtDlpProgress('[download]  45.3% of  123.45MiB at    2.34MiB/s ETA 00:12')
    ).toEqual({ percent: 45.3, total: '123.45MiB', speed: '2.34MiB/s', eta: '00:12' });
  });

  it('兼容 Unknown 速度与缺失 ETA', () => {
    const parsed = parseYtDlpProgress('[download]  12.0% of ~ 88.10MiB at Unknown');
    expect(parsed).toMatchObject({ percent: 12, total: '~ 88.10MiB' });
  });

  it('非进度行返回 null', () => {
    expect(parseYtDlpProgress('[info] Downloading video')).toBeNull();
    expect(parseYtDlpProgress('')).toBeNull();
  });
});

describe('parseYtDlpItem', () => {
  it('解析列表序号', () => {
    expect(parseYtDlpItem('[download] Downloading item 3 of 12')).toEqual({ index: 3, total: 12 });
    expect(parseYtDlpItem('[download] Downloading video 2 of 5')).toEqual({ index: 2, total: 5 });
  });
});

describe('overallPercent', () => {
  it('把当前项进度折算成整体进度', () => {
    expect(overallPercent(1, 4, 50)).toBe(13);
    expect(overallPercent(4, 4, 100)).toBe(99);
    expect(overallPercent(1, 1, 42)).toBe(42);
  });
});
