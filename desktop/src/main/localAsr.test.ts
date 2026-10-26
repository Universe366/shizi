import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AsrPlatform } from '../shared/types';
import {
  detectSilences,
  parseWhisperJson,
  parseWhisperOutput,
  parseWhisperStdout,
  resolveLocalWhisperPaths,
  toSimplified
} from './localAsr';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-asr-test-'));
const exe = path.join(temp, 'whisper-cli.exe');
const model = path.join(temp, 'ggml-base.bin');
fs.writeFileSync(exe, 'fake');
fs.writeFileSync(model, 'fake');

afterAll(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

describe('parseWhisperJson', () => {
  it('优先用 offsets 生成时间轴', () => {
    const segments = parseWhisperJson(
      JSON.stringify({
        transcription: [
          { offsets: { from: 1500, to: 4200 }, text: ' 第一句' },
          { offsets: { from: 4200, to: 9000 }, text: ' 第二句 ' }
        ]
      })
    );
    expect(segments).toEqual([
      { start: 1.5, end: 4.2, text: '第一句' },
      { start: 4.2, end: 9, text: '第二句' }
    ]);
  });

  it('没有 offsets 时解析 timestamps', () => {
    const segments = parseWhisperJson(
      JSON.stringify({
        transcription: [
          {
            timestamps: { from: '00:00:01,000', to: '00:00:03,500' },
            text: '你好'
          }
        ]
      })
    );
    expect(segments[0]).toMatchObject({ start: 1, end: 3.5, text: '你好' });
  });

  it('坏 JSON 返回空数组', () => {
    expect(parseWhisperJson('not json')).toEqual([]);
  });
});

describe('parseWhisperStdout', () => {
  it('解析标准输出里的时间轴', () => {
    const segments = parseWhisperStdout(
      [
        'whisper_init_from_file: loading model',
        '[00:00:01.000 --> 00:00:03.200]   第一行',
        '[00:00:03.200 --> 00:00:05.000]   第二行'
      ].join('\n')
    );
    expect(segments).toEqual([
      { start: 1, end: 3.2, text: '第一行' },
      { start: 3.2, end: 5, text: '第二行' }
    ]);
  });
});

describe('parseWhisperOutput', () => {
  it('有 JSON 时用 JSON，没有时回退 stdout', () => {
    expect(
      parseWhisperOutput('[00:00:01.000 --> 00:00:02.000] 旧格式')
    ).toHaveLength(1);
    expect(
      parseWhisperOutput('[00:00:01.000 --> 00:00:02.000] 旧格式', JSON.stringify({ transcription: [] }))
    ).toHaveLength(1);
    expect(
      parseWhisperOutput(
        '',
        JSON.stringify({ transcription: [{ offsets: { from: 0, to: 1000 }, text: '新格式' }] })
      )
    ).toHaveLength(1);
  });
});

describe('resolveLocalWhisperPaths', () => {
  const platform = (patch: Partial<AsrPlatform>) =>
    ({
      id: 'local-whisper',
      name: '本地',
      baseUrl: '',
      apiKey: '',
      model: '',
      kind: 'local-whisper',
      ...patch
    }) as AsrPlatform;

  it('文件齐全时返回路径', () => {
    expect(resolveLocalWhisperPaths(platform({ localExe: exe, localModel: model }))).toEqual({
      exe,
      model
    });
  });

  it('缺 exe / 模型时给出可照做的提示', () => {
    expect(() => resolveLocalWhisperPaths(platform({ localModel: model }))).toThrow(
      /选择 whisper\.cpp 的可执行文件/
    );
    expect(() =>
      resolveLocalWhisperPaths(platform({ localExe: exe, localModel: path.join(temp, 'none.bin') }))
    ).toThrow(/找不到模型文件/);
  });
});

describe('词级时间戳切分', () => {  it('超长段落按 token offsets 切成多行', () => {
    const tokens = [
      'This',
      ' is',
      ' a',
      ' long',
      ' sentence',
      ' that',
      ' should',
      ' be',
      ' split',
      ' into',
      ' multiple',
      ' readable',
      ' lines',
      ' by',
      ' tokens.'
    ];
    const json = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 4000 },
          text: tokens.join(''),
          tokens: tokens.map((text, index) => ({
            text,
            offsets: { from: index * 250, to: (index + 1) * 250 }
          }))
        }
      ]
    });
    const segments = parseWhisperJson(json);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBeLessThanOrEqual(4);
    expect(segments.map((item) => item.text).join(' ')).toContain('tokens');
  });
});

describe('静音检测', () => {
  it('解析 ffmpeg silencedetect 日志', () => {
    const ranges = detectSilences(
      [
        '[silencedetect @ 0000] silence_start: 1.2',
        '[silencedetect @ 0000] silence_end: 2.4 | silence_duration: 1.2',
        '[silencedetect @ 0000] silence_start: 5',
        '[silencedetect @ 0000] silence_end: 5.2 | silence_duration: 0.2'
      ].join('\n')
    );
    expect(ranges).toEqual([{ start: 1.2, end: 2.4 }]);
  });
});

describe('繁体转简体', () => {
  it('中文输出统一转成简体', () => {
    expect(toSimplified('這是繁體中文，後面還有測試。')).toBe('这是繁体中文，后面还有测试。');
    expect(toSimplified('hello world')).toBe('hello world');
  });
});
