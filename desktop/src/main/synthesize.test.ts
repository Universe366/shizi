import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_STYLE } from '../shared/ass';
import { synthesizeVideo } from './synthesize';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-synth-test-'));
const video = path.join(dir, 'input.mp4');

beforeAll(() => {
  if (!ffmpegStatic) return;
  const result = spawnSync(
    ffmpegStatic,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x240:d=1.2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1.2',
      '-shortest',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      video
    ],
    { windowsHide: true }
  );
  if (result.status !== 0) throw new Error(String(result.stderr));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('synthesizeVideo', () => {
  it('硬字幕输出 mp4', async () => {
    if (!ffmpegStatic) return;
    const output = path.join(dir, 'hard.mp4');
    await synthesizeVideo(
      {
        requestId: 'test-hard',
        videoPath: video,
        title: '测试',
        mode: 'hard',
        style: DEFAULT_SUBTITLE_STYLE,
        lines: [{ start: 0, end: 1, text: '本地测试字幕' }]
      },
      output,
      () => undefined
    );
    expect(fs.existsSync(output)).toBe(true);
    expect(fs.statSync(output).size).toBeGreaterThan(1000);
  });

  it('软字幕封装 mkv', async () => {
    if (!ffmpegStatic) return;
    const output = path.join(dir, 'soft.mkv');
    await synthesizeVideo(
      {
        requestId: 'test-soft',
        videoPath: video,
        title: '测试',
        mode: 'soft',
        style: DEFAULT_SUBTITLE_STYLE,
        lines: [{ start: 0, end: 1, text: '软字幕测试' }]
      },
      output,
      () => undefined
    );
    expect(fs.existsSync(output)).toBe(true);
    expect(fs.statSync(output).size).toBeGreaterThan(1000);
  });
});
