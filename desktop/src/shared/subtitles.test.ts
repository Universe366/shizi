import { describe, expect, it } from 'vitest';
import { parseSubtitleText } from './subtitles';

describe('parseSubtitleText', () => {
  it('解析 SRT（含序号、逗号毫秒、多行文本）', () => {
    const lines = parseSubtitleText(
      [
        '\uFEFF1',
        '00:00:01,000 --> 00:00:03,500',
        '<i>第一行</i>',
        '第二行',
        '',
        '2',
        '00:00:04,000 --> 00:00:06,000',
        'Hello &amp; world',
        ''
      ].join('\r\n')
    );
    expect(lines).toEqual([
      { start: 1, end: 3.5, text: '第一行 第二行' },
      { start: 4, end: 6, text: 'Hello & world' }
    ]);
  });

  it('解析 WebVTT（可省略小时、带 NOTE 与 cue 设置）', () => {
    const lines = parseSubtitleText(
      [
        'WEBVTT',
        '',
        'NOTE 这是注释',
        '',
        '00:01.000 --> 00:02.500 align:start position:0%',
        'vtt 文本',
        '',
        '00:00:03.000 --> 00:00:04.000',
        '<c.yellow>第三句</c>',
        ''
      ].join('\n')
    );
    expect(lines).toEqual([
      { start: 1, end: 2.5, text: 'vtt 文本' },
      { start: 3, end: 4, text: '第三句' }
    ]);
  });

  it('纯文本 / 空内容返回空数组', () => {
    expect(parseSubtitleText('没有时间轴的文本')).toEqual([]);
    expect(parseSubtitleText('')).toEqual([]);
  });

  it('结束时间早于开始时间时兜底 0.3 秒', () => {
    const [line] = parseSubtitleText(
      ['00:00:05,000 --> 00:00:04,000', '异常时间'].join('\n')
    );
    expect(line.start).toBe(5);
    expect(line.end).toBe(5.3);
  });
});
