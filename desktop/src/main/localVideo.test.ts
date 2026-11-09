import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir }
}));

import {
  ensureLocalPlayerHtml,
  isPlayableVideoFile,
  localFileFromPageUrl,
  localPlayerUrl,
  localVideoInfo,
  localVideoTitle
} from './localVideo';

describe('local video', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-local-video-'));
  });
  afterAll(() => {
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('只放行 Chromium 能直接播放的格式', () => {
    expect(isPlayableVideoFile('a.mp4')).toBe(true);
    expect(isPlayableVideoFile('a.WEBM')).toBe(true);
    expect(isPlayableVideoFile('a.mkv')).toBe(false);
    expect(isPlayableVideoFile('a.flv')).toBe(false);
  });

  it('播放页地址能还原出视频路径（含空格/中文）', () => {
    ensureLocalPlayerHtml();
    const file = path.join(state.dir, '测试 视频.mp4');
    expect(localFileFromPageUrl(localPlayerUrl(file))).toBe(file);
    expect(localFileFromPageUrl(localPlayerUrl(file))).not.toContain('local-player');
  });

  it('本地 PageInfo 用文件地址作身份，标题去掉扩展名', () => {
    const file = path.join(state.dir, '第 1 集.mkv');
    const info = localVideoInfo(file, 93);
    expect(info.kind).toBe('local');
    expect(info.title).toBe('第 1 集');
    expect(info.duration).toBe(93);
    expect(info.url.startsWith('file://')).toBe(true);
    expect(localVideoTitle(file)).toBe('第 1 集');
  });
});
